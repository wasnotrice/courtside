defmodule Courtside.SyncConcurrencyTest do
  @moduledoc """
  Runs real concurrent transactions, outside the SQL sandbox (whose shared
  connection would serialize everything and prove nothing). Rows are committed,
  so the test cleans up after itself.
  """
  use ExUnit.Case, async: false

  import Courtside.SyncHelpers

  alias Courtside.Repo
  alias Ecto.Adapters.SQL.Sandbox

  setup do
    Sandbox.mode(Repo, :auto)
    clean!()

    on_exit(fn ->
      clean!()
      Sandbox.mode(Repo, :manual)
    end)
  end

  test "concurrent pushes get distinct versions, and a pull racing them never skips a row" do
    org = org!()
    clients = for i <- 1..20, do: "client-#{i}"

    pushes =
      Task.async_stream(
        clients,
        fn client -> push!(org.org, client, [{"player.put", player(org, client)}]) end,
        max_concurrency: 20,
        ordered: false
      )

    # A client pulling in a loop while the pushes commit, like a phone with a
    # flaky connection. With versions assigned out of commit order, it would
    # sometimes advance its cursor past a row that hadn't committed yet.
    puller =
      Task.async(fn ->
        pull_until(org.org, fn seen -> MapSet.size(seen) == 20 end, 0, MapSet.new(), 0)
      end)

    Stream.run(pushes)
    {seen, cursor} = Task.await(puller, 10_000)

    versions = Repo.query!("SELECT version FROM players ORDER BY version").rows |> List.flatten()
    assert versions == Enum.uniq(versions)
    assert length(versions) == 20
    assert MapSet.size(seen) == 20
    assert cursor == List.last(versions)
  end

  defp pull_until(org, done?, cursor, seen, attempts) when attempts < 2_000 do
    %{cursor: next, changes: %{players: players}} = pull!(org, "observer", cursor)
    seen = Enum.reduce(players, seen, &MapSet.put(&2, &1.id))
    if done?.(seen), do: {seen, next}, else: pull_until(org, done?, next, seen, attempts + 1)
  end

  # Every table, children before parents so foreign keys hold.
  @tables ~w(change_log mutation_rejections clients plays games results drill_runs drills
             roster_entries players teams seasons programs org_versions organizations)

  defp clean!, do: Enum.each(@tables, &Repo.query!("DELETE FROM #{&1}"))
end
