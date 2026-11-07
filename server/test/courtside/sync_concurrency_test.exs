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

  @tables ~w(results drill_runs drills players mutation_rejections clients)

  setup do
    Sandbox.mode(Repo, :auto)
    Application.put_env(:courtside, :snapshot_pulls, true)
    clean!()

    on_exit(fn ->
      clean!()
      Application.put_env(:courtside, :snapshot_pulls, false)
      Sandbox.mode(Repo, :manual)
    end)
  end

  test "concurrent pushes get distinct versions, and a pull racing them never skips a row" do
    clients = for i <- 1..20, do: "client-#{i}"

    pushes =
      Task.async_stream(
        clients,
        fn client -> push!(client, [{"player.put", %{id: uuid(), name: client}}]) end,
        max_concurrency: 20,
        ordered: false
      )

    # A client pulling in a loop while the pushes commit, like a phone with a
    # flaky connection. With versions assigned out of commit order, it would
    # sometimes advance its cursor past a row that hadn't committed yet.
    puller =
      Task.async(fn -> pull_until(fn seen -> MapSet.size(seen) == 20 end, 0, MapSet.new(), 0) end)

    Stream.run(pushes)
    {seen, cursor} = Task.await(puller, 10_000)

    versions = Repo.query!("SELECT version FROM players ORDER BY version").rows |> List.flatten()
    assert versions == Enum.uniq(versions)
    assert length(versions) == 20
    assert MapSet.size(seen) == 20
    assert cursor == List.last(versions)
  end

  defp pull_until(done?, cursor, seen, attempts) when attempts < 2_000 do
    %{cursor: next, changes: %{players: players}} = pull!("observer", cursor)
    seen = Enum.reduce(players, seen, &MapSet.put(&2, &1.id))
    if done?.(seen), do: {seen, next}, else: pull_until(done?, next, seen, attempts + 1)
  end

  defp clean! do
    Repo.query!("TRUNCATE #{Enum.join(@tables, ", ")}")
    Repo.query!("UPDATE server_meta SET version = 0")
  end
end
