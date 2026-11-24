defmodule Courtside.Sync do
  @moduledoc """
  Hand-rolled push/pull sync, scoped by organization (see ADR 0001).

  Push: a client sends its pending mutations in order. Each push runs in one
  writing transaction (`Courtside.Database.write_transaction/1`, so pushes within an
  organization are serialized) that first bumps its organization's counter in
  `org_versions` and stamps every row it writes with the new version. Mutations at or below the
  client's `last_mutation_id` were already processed and are skipped, which
  makes retries safe. A mutation that fails validation is rolled back to its
  savepoint, recorded as a rejection, and still counts as processed.

  Pull: a client sends the version it last saw (its cursor) and gets every row
  in its organization with a higher version, tombstones included, plus its
  `last_mutation_id` so it can drop pending mutations the server has handled.
  Pull reads in one snapshot (`Courtside.Database.read_transaction/1`), so the rows
  and the new cursor are consistent. It also returns `data_id`; when that changes, the server's data
  was recreated or restored and the client must pull from scratch.

  A client id belongs to the organization it first pushed or pulled in. Using it
  with another organization is refused.
  """

  import Ecto.Query
  require Logger

  alias Courtside.{Database, Repo}

  alias Courtside.Schema.{
    ChangeLogEntry,
    Client,
    Drill,
    DrillRun,
    Game,
    MutationRejection,
    OrgVersion,
    Play,
    Player,
    Program,
    Result,
    RosterEntry,
    Season,
    Team
  }

  alias Courtside.Sync.Mutators

  # The most mutations one push may carry. A client with more sends them in
  # batches. Together with the request size limit in the endpoint, this keeps
  # one client from holding its organization's lock for long.
  @max_mutations 500
  def max_mutations, do: @max_mutations

  # Wire name, schema and the fields a client sees (plus deleted and version).
  @tables [
    {:programs, Program, [:id, :name, :sport]},
    {:seasons, Season, [:id, :name, :starts_on, :ends_on]},
    {:teams, Team, [:id, :program_id, :name, :default_rules]},
    {:players, Player, [:id, :program_id, :name]},
    {:roster_entries, RosterEntry, [:id, :team_id, :season_id, :player_id, :jersey]},
    {:drills, Drill, [:id, :program_id, :name, :kind, :default_setup, :archived, :game_stat]},
    {:runs, DrillRun, [:id, :program_id, :date, :drill_id, :setup]},
    # Results are addressed by (run, player); the server's id stays internal.
    {:results, Result, [:drill_run_id, :player_id, :value, :setup]},
    {:games, Game,
     [:id, :team_id, :date, :opponent, :home_away, :status, :rules, :official_us, :official_them]},
    {:plays, Play,
     [
       :id,
       :game_id,
       :side,
       :player_id,
       :stat,
       :foul_type,
       :assist_player_id,
       :drawn_by_player_id,
       :period,
       :clock,
       :video_at,
       :position,
       :recorded_at
     ]}
  ]

  @type error :: :unknown_organization | :wrong_organization | :too_many_mutations

  def poke_topic(organization_id), do: "sync:" <> organization_id

  @doc """
  Processes a batch of mutations for `client_id` in `organization_id`. Returns
  the client's `last_mutation_id` after the push and any rejections for
  mutations in the batch.
  """
  @spec push(String.t(), String.t(), [map()]) :: {:ok, map()} | {:error, error()}
  def push(organization_id, client_id, mutations)
      when is_binary(client_id) and is_list(mutations) do
    with {:ok, org} <- cast_org(organization_id),
         :ok <- check_size(mutations),
         {:ok, result} <-
           Database.write_transaction(fn -> push_in_transaction(org, client_id, mutations) end) do
      Phoenix.PubSub.broadcast(Courtside.PubSub, poke_topic(org), :poke)
      {:ok, result}
    end
  end

  defp push_in_transaction(org, client_id, mutations) do
    with {:ok, version} <- bump_version(org),
         {:ok, last} <- lock_client(org, client_id) do
      ctx = %{organization_id: org, version: version}
      mutations = Enum.sort_by(mutations, & &1["id"])

      last =
        Enum.reduce(mutations, last, fn m, last ->
          if m["id"] <= last do
            last
          else
            apply_mutation(client_id, m, ctx)
            m["id"]
          end
        end)

      Repo.update_all(from(c in Client, where: c.id == ^client_id),
        set: [last_mutation_id: last, updated_at: DateTime.utc_now(:second)]
      )

      %{
        last_mutation_id: last,
        rejections: rejections_for(client_id, Enum.map(mutations, & &1["id"]))
      }
    else
      {:error, reason} -> Repo.rollback(reason)
    end
  end

  @doc """
  Returns rows in `organization_id` changed since `cursor`, the new cursor, the
  server's `data_id`, and the client's `last_mutation_id` and rejections since
  `cursor`.
  """
  @spec pull(String.t(), String.t(), non_neg_integer()) :: {:ok, map()} | {:error, error()}
  def pull(organization_id, client_id, cursor)
      when is_binary(client_id) and is_integer(cursor) do
    with {:ok, org} <- cast_org(organization_id) do
      Database.read_transaction(fn -> pull_in_transaction(org, client_id, cursor) end)
    end
  end

  defp pull_in_transaction(org, client_id, cursor) do
    meta =
      Repo.one(
        from v in OrgVersion,
          where: v.organization_id == ^org,
          select: %{version: v.version, data_id: v.data_id}
      )

    client =
      Repo.one(
        from c in Client,
          where: c.id == ^client_id,
          select: %{organization_id: c.organization_id, last: c.last_mutation_id}
      )

    cond do
      meta == nil ->
        Repo.rollback(:unknown_organization)

      client != nil and client.organization_id != org ->
        Repo.rollback(:wrong_organization)

      true ->
        rejections =
          from(r in MutationRejection,
            where: r.client_id == ^client_id and r.version > ^cursor,
            order_by: r.mutation_id,
            select: %{mutation_id: r.mutation_id, name: r.name, args: r.args, reason: r.reason}
          )
          |> Repo.all()

        %{
          cursor: meta.version,
          data_id: meta.data_id,
          last_mutation_id: if(client, do: client.last, else: 0),
          rejections: rejections,
          changes:
            Map.new(@tables, fn {name, schema, fields} ->
              {name, changed(schema, fields, org, cursor)}
            end)
        }
    end
  end

  defp cast_org(organization_id) do
    case Ecto.UUID.cast(organization_id) do
      {:ok, org} -> {:ok, org}
      :error -> {:error, :unknown_organization}
    end
  end

  defp check_size(mutations) when length(mutations) > @max_mutations,
    do: {:error, :too_many_mutations}

  defp check_size(_mutations), do: :ok

  defp bump_version(org) do
    case Repo.update_all(
           from(v in OrgVersion, where: v.organization_id == ^org, select: v.version),
           inc: [version: 1]
         ) do
      {1, [version]} -> {:ok, version}
      {0, _} -> {:error, :unknown_organization}
    end
  end

  defp lock_client(org, client_id) do
    now = DateTime.utc_now(:second)

    Repo.insert_all(
      Client,
      [
        %{
          id: client_id,
          organization_id: org,
          last_mutation_id: 0,
          inserted_at: now,
          updated_at: now
        }
      ],
      on_conflict: :nothing
    )

    client =
      from(c in Client,
        where: c.id == ^client_id,
        select: %{organization_id: c.organization_id, last: c.last_mutation_id}
      )
      |> Database.lock()
      |> Repo.one!()

    if client.organization_id == org,
      do: {:ok, client.last},
      else: {:error, :wrong_organization}
  end

  defp apply_mutation(client_id, %{"id" => id, "name" => name} = m, ctx) do
    args = Map.get(m, "args", %{})
    Repo.query!("SAVEPOINT mutation")

    outcome =
      try do
        Mutators.run(name, args, ctx)
      rescue
        # A crashing mutation must not wedge the client's queue: reject it and move on.
        e ->
          Logger.error(
            "Mutation #{name} crashed: " <> Exception.format(:error, e, __STACKTRACE__)
          )

          {:error, "The server could not apply this change."}
      end

    case outcome do
      {:error, reason} ->
        Repo.query!("ROLLBACK TO SAVEPOINT mutation")
        record_rejection(client_id, id, name, args, reason, ctx.version)
        log_change(client_id, m, ctx, %{accepted: false, reason: reason})

      accepted ->
        Repo.query!("RELEASE SAVEPOINT mutation")

        row =
          case accepted do
            {:ok, row} -> row
            :ok -> %{}
          end

        log_change(client_id, m, ctx, Map.put(row, :accepted, true))
    end
  end

  # The change log: every mutation the server handles, accepted or refused, with what
  # it changed. Never synced; read through history/3.
  defp log_change(client_id, %{"id" => id, "name" => name} = m, ctx, entry) do
    [name, args, reason] = scrub([name, Map.get(m, "args", %{}), entry[:reason]])
    {row_table, row_key} = Map.get(entry, :row_table) |> row_of(entry, name, args)

    Repo.insert_all(ChangeLogEntry, [
      %{
        id: Ecto.UUID.generate(),
        organization_id: ctx.organization_id,
        version: ctx.version,
        client_id: client_id,
        mutation_id: id,
        name: name,
        args: if(is_map(args), do: args, else: %{"value" => args}),
        accepted: entry.accepted,
        reason: reason,
        row_table: row_table,
        row_key: row_key,
        changes: entry[:changes],
        inserted_at: DateTime.utc_now()
      }
    ])
  end

  # The row a change is about. Accepted changes say which row they wrote; refused
  # (and no-op) ones are matched from the mutation's name and args.
  defp row_of(nil, _entry, name, args) when is_map(args) do
    table =
      case name |> String.split(".") |> hd() do
        "program" -> "programs"
        "season" -> "seasons"
        "team" -> "teams"
        "player" -> "players"
        "roster" -> "roster_entries"
        "drill" -> "drills"
        "run" -> "runs"
        "result" -> "results"
        "game" -> "games"
        "play" -> "plays"
        _ -> nil
      end

    key =
      if table == "results",
        do: "#{args["drill_run_id"]}/#{args["player_id"]}",
        else: args["id"]

    {table, if(is_binary(key), do: key)}
  end

  defp row_of(nil, _entry, _name, _args), do: {nil, nil}
  defp row_of(table, entry, _name, _args), do: {table, entry.row_key}

  @doc """
  The change log for one row (`table` and `key` as pull names them), newest first:
  who changed what, when, and each field's value before and after. Refused changes
  that named the row are included.
  """
  @spec history(String.t(), String.t(), String.t(), pos_integer()) ::
          {:ok, [map()]} | {:error, :unknown_organization}
  def history(organization_id, table, key, limit \\ 100) do
    with {:ok, org} <- cast_org(organization_id),
         true <-
           Repo.exists?(from v in OrgVersion, where: v.organization_id == ^org) ||
             {:error, :unknown_organization} do
      {:ok,
       from(c in ChangeLogEntry,
         where:
           c.organization_id == ^org and
             (c.row_table == ^table and c.row_key == ^key),
         order_by: [desc: c.version, desc: c.mutation_id],
         limit: ^limit,
         select: %{
           version: c.version,
           client_id: c.client_id,
           mutation_id: c.mutation_id,
           name: c.name,
           accepted: c.accepted,
           reason: c.reason,
           changes: c.changes,
           at: c.inserted_at
         }
       )
       |> Repo.all()}
    end
  end

  # The rejection must always be stored, or the push fails and the client's
  # queue is stuck behind this mutation forever. Scrub NUL bytes from anything the
  # client sent: Postgres refuses them in text and JSON, and C strings end at them.
  defp record_rejection(client_id, mutation_id, name, args, reason, version) do
    [name, args, reason] = scrub([name, args, reason])

    Repo.insert_all(
      MutationRejection,
      [
        %{
          id: Ecto.UUID.generate(),
          client_id: client_id,
          mutation_id: mutation_id,
          name: name,
          args: args,
          reason: reason,
          version: version,
          inserted_at: DateTime.utc_now(:second)
        }
      ],
      on_conflict: :nothing
    )
  end

  defp scrub(s) when is_binary(s), do: String.replace(s, <<0>>, "�")
  defp scrub(list) when is_list(list), do: Enum.map(list, &scrub/1)
  defp scrub(map) when is_map(map), do: Map.new(map, fn {k, v} -> {scrub(k), scrub(v)} end)
  defp scrub(other), do: other

  defp rejections_for(client_id, ids) do
    from(r in MutationRejection,
      where: r.client_id == ^client_id and r.mutation_id in ^ids,
      order_by: r.mutation_id,
      select: %{mutation_id: r.mutation_id, name: r.name, args: r.args, reason: r.reason}
    )
    |> Repo.all()
  end

  defp changed(schema, fields, org, cursor) do
    from(r in schema,
      where: r.organization_id == ^org and r.version > ^cursor,
      order_by: r.version
    )
    |> Repo.all()
    |> Enum.map(&to_wire(&1, fields))
  end

  defp to_wire(row, fields) do
    row
    |> Map.take(fields ++ [:deleted, :version])
    |> Map.new(fn
      {k, %Date{} = d} -> {k, Date.to_iso8601(d)}
      pair -> pair
    end)
  end
end
