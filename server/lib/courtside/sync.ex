defmodule Courtside.Sync do
  @moduledoc """
  Hand-rolled push/pull sync, scoped by organization (see ADR 0001).

  Push: a client sends its pending mutations in order. Each push runs in one
  transaction that first bumps its organization's counter in `org_versions`
  (taking that row's lock, so pushes within an organization are serialized) and
  stamps every row it writes with the new version. Mutations at or below the
  client's `last_mutation_id` were already processed and are skipped, which
  makes retries safe. A mutation that fails validation is rolled back to its
  savepoint, recorded as a rejection, and still counts as processed.

  Pull: a client sends the version it last saw (its cursor) and gets every row
  in its organization with a higher version, tombstones included, plus its
  `last_mutation_id` so it can drop pending mutations the server has handled.
  Pull reads in one REPEATABLE READ snapshot, so the rows and the new cursor are
  consistent. It also returns `data_id`; when that changes, the server's data
  was recreated or restored and the client must pull from scratch.

  A client id belongs to the organization it first pushed or pulled in. Using it
  with another organization is refused.
  """

  import Ecto.Query
  require Logger

  alias Courtside.Repo
  alias Courtside.Schema.{Drill, DrillRun, Player, Program, Result, RosterEntry, Season, Team}
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
    {:teams, Team, [:id, :program_id, :name]},
    {:players, Player, [:id, :program_id, :name]},
    {:roster_entries, RosterEntry, [:id, :team_id, :season_id, :player_id, :jersey]},
    {:drills, Drill, [:id, :program_id, :name, :kind, :default_setup, :archived]},
    {:runs, DrillRun, [:id, :program_id, :date, :drill_id, :setup]},
    # Results are addressed by (run, player); the server's id stays internal.
    {:results, Result, [:drill_run_id, :player_id, :value, :setup]}
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
           Repo.transaction(fn -> push_in_transaction(org, client_id, mutations) end) do
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

      Repo.update_all(from(c in "clients", where: c.id == ^client_id),
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
      Repo.transaction(fn -> pull_in_transaction(org, client_id, cursor) end)
    end
  end

  defp pull_in_transaction(org, client_id, cursor) do
    if snapshot_pulls?(),
      do: Repo.query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")

    meta =
      Repo.one(
        from v in "org_versions",
          where: v.organization_id == type(^org, Ecto.UUID),
          select: %{version: v.version, data_id: type(v.data_id, Ecto.UUID)}
      )

    client =
      Repo.one(
        from c in "clients",
          where: c.id == ^client_id,
          select: %{
            organization_id: type(c.organization_id, Ecto.UUID),
            last: c.last_mutation_id
          }
      )

    cond do
      meta == nil ->
        Repo.rollback(:unknown_organization)

      client != nil and client.organization_id != org ->
        Repo.rollback(:wrong_organization)

      true ->
        rejections =
          from(r in "mutation_rejections",
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

  # The SQL sandbox wraps each test in a transaction, where SET TRANSACTION is
  # no longer allowed, so test.exs turns this off. Tests that run outside the
  # sandbox turn it back on.
  defp snapshot_pulls?, do: Application.get_env(:courtside, :snapshot_pulls, true)

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
           from(v in "org_versions",
             where: v.organization_id == type(^org, Ecto.UUID),
             select: v.version
           ),
           inc: [version: 1]
         ) do
      {1, [version]} -> {:ok, version}
      {0, _} -> {:error, :unknown_organization}
    end
  end

  defp lock_client(org, client_id) do
    now = DateTime.utc_now(:second)

    Repo.insert_all(
      "clients",
      [
        %{
          id: client_id,
          organization_id: Ecto.UUID.dump!(org),
          last_mutation_id: 0,
          inserted_at: now,
          updated_at: now
        }
      ],
      on_conflict: :nothing
    )

    client =
      Repo.one!(
        from c in "clients",
          where: c.id == ^client_id,
          lock: "FOR UPDATE",
          select: %{
            organization_id: type(c.organization_id, Ecto.UUID),
            last: c.last_mutation_id
          }
      )

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
      :ok ->
        Repo.query!("RELEASE SAVEPOINT mutation")

      {:error, reason} ->
        Repo.query!("ROLLBACK TO SAVEPOINT mutation")
        record_rejection(client_id, id, name, args, reason, ctx.version)
    end
  end

  # The rejection must always be stored, or the push fails and the client's
  # queue is stuck behind this mutation forever. Postgres refuses NUL bytes in
  # text and jsonb, so scrub them from anything the client sent.
  defp record_rejection(client_id, mutation_id, name, args, reason, version) do
    [name, args, reason] = scrub([name, args, reason])

    Repo.insert_all(
      "mutation_rejections",
      [
        %{
          id: Ecto.UUID.bingenerate(),
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
    from(r in "mutation_rejections",
      where: r.client_id == ^client_id and r.mutation_id in type(^ids, {:array, :integer}),
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
