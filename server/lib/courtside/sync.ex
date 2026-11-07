defmodule Courtside.Sync do
  @moduledoc """
  Hand-rolled push/pull sync (global-version strategy).

  Push: a client sends its pending mutations in order. Each push runs in one
  transaction that first bumps `server_meta.version` (taking its row lock, so
  pushes are serialized) and stamps every row it writes with that version.
  Mutations at or below the client's `last_mutation_id` were already processed
  and are skipped, which makes retries safe. A mutation that fails validation is
  rolled back to its savepoint, recorded as a rejection, and still counts as
  processed.

  Pull: a client sends the version it last saw (its cursor) and gets every row
  with a higher version, tombstones included, plus its `last_mutation_id` so it
  can drop pending mutations the server has handled. Pull reads in one
  REPEATABLE READ snapshot, so the rows and the new cursor are consistent.
  """

  import Ecto.Query
  require Logger

  alias Courtside.Repo
  alias Courtside.Practice.{Player, Drill, DrillRun, Result}
  alias Courtside.Sync.Mutators

  @poke_topic "sync"

  def poke_topic, do: @poke_topic

  @type mutation :: %{required(String.t()) => term()}

  @doc """
  Processes a batch of mutations for `client_id`. Returns the client's
  `last_mutation_id` after the push and any rejections for mutations in the batch.
  """
  def push(client_id, mutations) when is_binary(client_id) and is_list(mutations) do
    mutations = Enum.sort_by(mutations, & &1["id"])

    result =
      Repo.transaction(fn ->
        version = bump_version()
        last = lock_client(client_id)

        last =
          Enum.reduce(mutations, last, fn m, last ->
            if m["id"] <= last do
              last
            else
              apply_mutation(client_id, m, version)
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
      end)

    with {:ok, _} <- result do
      Phoenix.PubSub.broadcast(Courtside.PubSub, @poke_topic, :poke)
    end

    result
  end

  @doc """
  Returns rows changed since `cursor`, the new cursor, and the client's
  `last_mutation_id` and rejections since `cursor`.
  """
  def pull(client_id, cursor) when is_binary(client_id) and is_integer(cursor) do
    Repo.transaction(fn ->
      if snapshot_pulls?(),
        do: Repo.query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")

      version = Repo.one!(from m in "server_meta", where: m.id == 1, select: m.version)

      last =
        Repo.one(from c in "clients", where: c.id == ^client_id, select: c.last_mutation_id) || 0

      rejections =
        from(r in "mutation_rejections",
          where: r.client_id == ^client_id and r.version > ^cursor,
          order_by: r.mutation_id,
          select: %{mutation_id: r.mutation_id, name: r.name, args: r.args, reason: r.reason}
        )
        |> Repo.all()

      %{
        cursor: version,
        last_mutation_id: last,
        rejections: rejections,
        changes: %{
          players: changed(Player, cursor),
          drills: changed(Drill, cursor),
          runs: changed(DrillRun, cursor),
          results: changed(Result, cursor)
        }
      }
    end)
  end

  # The SQL sandbox wraps each test in a transaction, where SET TRANSACTION is
  # no longer allowed, so test.exs turns this off. Tests that run outside the
  # sandbox turn it back on.
  defp snapshot_pulls?, do: Application.get_env(:courtside, :snapshot_pulls, true)

  defp bump_version do
    {1, [version]} =
      Repo.update_all(from(m in "server_meta", where: m.id == 1, select: m.version),
        inc: [version: 1]
      )

    version
  end

  defp lock_client(client_id) do
    now = DateTime.utc_now(:second)

    Repo.insert_all(
      "clients",
      [%{id: client_id, last_mutation_id: 0, inserted_at: now, updated_at: now}],
      on_conflict: :nothing
    )

    Repo.one!(
      from c in "clients",
        where: c.id == ^client_id,
        lock: "FOR UPDATE",
        select: c.last_mutation_id
    )
  end

  defp apply_mutation(client_id, %{"id" => id, "name" => name} = m, version) do
    args = Map.get(m, "args", %{})
    Repo.query!("SAVEPOINT mutation")

    outcome =
      try do
        Mutators.run(name, args, version)
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
        record_rejection(client_id, id, name, args, reason, version)
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

  defp scrub(s) when is_binary(s), do: String.replace(s, <<0>>, "\uFFFD")
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

  defp changed(schema, cursor) do
    from(r in schema, where: r.version > ^cursor, order_by: r.version)
    |> Repo.all()
    |> Enum.map(&to_wire/1)
  end

  defp to_wire(%Player{} = p),
    do: Map.take(p, [:id, :name, :jersey, :active, :deleted, :version])

  defp to_wire(%Drill{} = d),
    do: Map.take(d, [:id, :name, :kind, :default_setup, :archived, :deleted, :version])

  defp to_wire(%DrillRun{} = r),
    do:
      Map.take(r, [:id, :date, :drill_id, :setup, :deleted, :version])
      |> Map.update!(:date, &Date.to_iso8601/1)

  defp to_wire(%Result{} = r),
    do: Map.take(r, [:drill_run_id, :player_id, :value, :setup, :deleted, :version])
end
