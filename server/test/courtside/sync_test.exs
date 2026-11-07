defmodule Courtside.SyncTest do
  use Courtside.DataCase, async: true

  import Courtside.SyncHelpers
  import ExUnit.CaptureLog

  alias Courtside.Practice.{DrillRun, Player, Result}
  alias Courtside.Sync

  @client "client-a"

  describe "push" do
    test "replaying the same push is a no-op" do
      id = uuid()
      specs = [{"player.put", %{id: id, name: "Ana", jersey: "4", active: true}}]

      assert %{last_mutation_id: 1, rejections: []} = push!(@client, specs)
      version = Repo.get!(Player, id).version

      assert %{last_mutation_id: 1, rejections: []} = push!(@client, specs)
      assert Repo.get!(Player, id).version == version
      assert Repo.aggregate(Player, :count) == 1
    end

    test "a retried batch applies only the mutations the server hasn't seen" do
      a = uuid()
      b = uuid()
      push!(@client, [{"player.put", %{id: a, name: "Ana"}}])

      result =
        push!(@client, [
          {"player.put", %{id: a, name: "Changed on retry"}},
          {"player.put", %{id: b, name: "Bea"}}
        ])

      assert result.last_mutation_id == 2
      assert Repo.get!(Player, a).name == "Ana"
      assert Repo.get!(Player, b).name == "Bea"
    end

    test "a rejected mutation is recorded and returned, and later mutations still apply" do
      good = uuid()

      result =
        push!(@client, [
          {"player.put", %{id: uuid(), name: "   "}},
          {"player.put", %{id: good, name: "Bea"}}
        ])

      assert %{last_mutation_id: 2, rejections: [rejection]} = result
      assert %{mutation_id: 1, name: "player.put", reason: "Name can't be blank"} = rejection
      assert Repo.get!(Player, good).name == "Bea"
      assert Repo.aggregate(Player, :count) == 1

      # Recorded, so a pull from before the push reports it too.
      assert [%{mutation_id: 1}] = pull!(@client).rejections
    end

    test "a crashing mutation is rejected without failing the push" do
      good = uuid()

      {result, log} =
        with_log(fn ->
          push!(@client, [
            {"player.put", %{id: "not-a-uuid", name: "Ana"}},
            {"player.put", %{id: good, name: "Bea"}}
          ])
        end)

      assert log =~ "Mutation player.put crashed"
      assert %{last_mutation_id: 2, rejections: [%{mutation_id: 1, reason: reason}]} = result
      assert reason =~ "could not apply"
      assert Repo.get!(Player, good)
    end

    test "a mutation that trips a database constraint is rejected and the transaction recovers" do
      ids = seed!(@client)

      # Postgres refuses NUL bytes in text and Elixir doesn't check for them, so
      # this raises inside the savepoint. The push must roll back to it and go on.
      {result, _log} =
        with_log(fn ->
          push!(
            @client,
            [
              {"player.put", %{id: uuid(), name: "Cam\u0000"}},
              {"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 10}}
            ],
            4
          )
        end)

      assert %{last_mutation_id: 5, rejections: [%{mutation_id: 4}]} = result
      assert Repo.get_by!(Result, drill_run_id: ids.run).value == 10.0
    end

    test "a blank or missing jersey is stored as an empty string" do
      a = uuid()
      b = uuid()

      assert %{rejections: []} =
               push!(@client, [
                 {"player.put", %{id: a, name: "Ana", jersey: ""}},
                 {"player.put", %{id: b, name: "Bea", jersey: nil, active: nil}}
               ])

      assert %Player{jersey: "", active: true} = Repo.get!(Player, a)
      assert %Player{jersey: "", active: true} = Repo.get!(Player, b)
    end

    test "unknown mutation names are rejected" do
      assert %{rejections: [%{reason: "Unknown change type: player.explode"}]} =
               push!(@client, [{"player.explode", %{}}])
    end

    test "kind can't change after a drill is created" do
      ids = seed!(@client)

      assert %{rejections: [%{reason: "Kind can't change after the drill is created"}]} =
               push!(
                 @client,
                 [{"drill.put", %{id: ids.drill, name: "Free throws", kind: "count"}}],
                 4
               )
    end

    test "makes drills require shots on a run" do
      ids = seed!(@client)

      assert %{rejections: [%{reason: "Setup shots are required"}]} =
               push!(
                 @client,
                 [
                   {"run.create",
                    %{id: uuid(), date: "2026-11-07", drill_id: ids.drill, setup: nil}}
                 ],
                 4
               )
    end

    test "every row a push writes carries that push's version" do
      ids = seed!(@client)
      version = Repo.get!(Player, ids.player).version

      assert Repo.get!(DrillRun, ids.run).version == version
      assert pull!(@client).cursor == version
    end
  end

  describe "makes can't exceed shots" do
    setup do
      ids = seed!(@client, setup: 50)

      push!(
        @client,
        [{"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 40}}],
        4
      )

      ids
    end

    test "result.set_value", ids do
      assert %{rejections: [%{reason: "51 makes is more than 50 shots."}]} =
               push!(
                 @client,
                 [
                   {"result.set_value",
                    %{drill_run_id: ids.run, player_id: ids.player, value: 51}}
                 ],
                 5
               )

      assert Repo.get_by!(Result, drill_run_id: ids.run).value == 40.0
    end

    test "result.set_value uses the player's own setup when overridden", ids do
      push!(
        @client,
        [{"result.set_setup", %{drill_run_id: ids.run, player_id: ids.player, setup: 60}}],
        5
      )

      assert %{rejections: []} =
               push!(
                 @client,
                 [
                   {"result.set_value",
                    %{drill_run_id: ids.run, player_id: ids.player, value: 55}}
                 ],
                 6
               )
    end

    test "run.set_setup", ids do
      assert %{rejections: [%{reason: "Ana has 40 makes, more than 30 shots."}]} =
               push!(@client, [{"run.set_setup", %{id: ids.run, setup: 30}}], 5)

      assert Repo.get!(DrillRun, ids.run).setup == 50.0
    end

    test "run.set_setup ignores players with their own setup", ids do
      push!(
        @client,
        [{"result.set_setup", %{drill_run_id: ids.run, player_id: ids.player, setup: 45}}],
        5
      )

      assert %{rejections: []} = push!(@client, [{"run.set_setup", %{id: ids.run, setup: 30}}], 6)
    end

    test "result.set_setup", ids do
      assert %{rejections: [%{reason: "40 makes is more than 30 shots."}]} =
               push!(
                 @client,
                 [
                   {"result.set_setup",
                    %{drill_run_id: ids.run, player_id: ids.player, setup: 30}}
                 ],
                 5
               )
    end

    test "result.set_setup with null resets to the run's setup", ids do
      push!(
        @client,
        [{"result.set_setup", %{drill_run_id: ids.run, player_id: ids.player, setup: 45}}],
        5
      )

      push!(
        @client,
        [{"result.set_setup", %{drill_run_id: ids.run, player_id: ids.player, setup: nil}}],
        6
      )

      assert Repo.get_by!(Result, drill_run_id: ids.run).setup == nil
    end
  end

  describe "setup overrides" do
    test "setting a setup on a cleared result revives it for pull" do
      ids = seed!(@client)
      key = %{drill_run_id: ids.run, player_id: ids.player}
      push!(@client, [{"result.set_value", Map.put(key, :value, 38)}, {"result.clear", key}], 4)
      push!(@client, [{"result.set_setup", Map.put(key, :setup, 40)}], 6)

      assert [%{value: nil, setup: 40.0, deleted: false}] = pull!(@client).changes.results
    end
  end

  describe "result values per kind" do
    test "makes must be whole numbers" do
      ids = seed!(@client)

      assert %{rejections: [%{reason: "Makes must be a whole number."}]} =
               push!(
                 @client,
                 [
                   {"result.set_value",
                    %{drill_run_id: ids.run, player_id: ids.player, value: 3.5}}
                 ],
                 4
               )
    end

    test "time must be above zero and may be fractional" do
      ids = seed!(@client, kind: "time", setup: 3)

      assert %{rejections: [%{reason: "Time must be above zero."}]} =
               push!(
                 @client,
                 [
                   {"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 0}}
                 ],
                 4
               )

      assert %{rejections: []} =
               push!(
                 @client,
                 [
                   {"result.set_value",
                    %{drill_run_id: ids.run, player_id: ids.player, value: 31.4}}
                 ],
                 5
               )
    end

    test "results can't be negative or non-numeric" do
      ids = seed!(@client, kind: "count", setup: 60)

      assert %{rejections: [%{reason: "Results can't be negative."}]} =
               push!(
                 @client,
                 [
                   {"result.set_value",
                    %{drill_run_id: ids.run, player_id: ids.player, value: -1}}
                 ],
                 4
               )

      assert %{rejections: [%{reason: "Enter a number."}]} =
               push!(
                 @client,
                 [
                   {"result.set_value",
                    %{drill_run_id: ids.run, player_id: ids.player, value: "12"}}
                 ],
                 5
               )
    end
  end

  describe "pull" do
    test "cursor 0 returns everything, and the returned cursor returns nothing new" do
      ids = seed!(@client)

      push!(
        @client,
        [{"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 38}}],
        4
      )

      first = pull!("another-client")
      assert [%{id: player_id, name: "Ana", deleted: false}] = first.changes.players
      assert player_id == ids.player
      assert [%{kind: "makes", default_setup: 50.0}] = first.changes.drills
      assert [%{date: "2026-11-06", setup: 50.0}] = first.changes.runs
      assert [%{value: 38.0, setup: nil}] = first.changes.results
      assert first.last_mutation_id == 0

      second = pull!("another-client", first.cursor)
      assert second.cursor == first.cursor
      assert second.changes == %{players: [], drills: [], runs: [], results: []}
    end

    test "results are keyed by run and player, without the server's id" do
      ids = seed!(@client)

      push!(
        @client,
        [{"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 38}}],
        4
      )

      [result] = pull!(@client).changes.results

      assert Map.keys(result) |> Enum.sort() == [
               :deleted,
               :drill_run_id,
               :player_id,
               :setup,
               :value,
               :version
             ]
    end

    test "reports the client's last_mutation_id" do
      seed!(@client)
      assert pull!(@client).last_mutation_id == 3
    end

    test "only reports rejections recorded after the cursor" do
      push!(@client, [{"player.put", %{id: uuid(), name: ""}}])
      %{cursor: cursor, rejections: [_]} = pull!(@client)

      assert pull!(@client, cursor).rejections == []
    end
  end

  describe "deletes" do
    test "run.delete tombstones the run and its results, and pull reports them" do
      ids = seed!(@client)

      push!(
        @client,
        [{"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 38}}],
        4
      )

      %{cursor: cursor} = pull!(@client)

      push!(@client, [{"run.delete", %{id: ids.run}}], 5)

      %{changes: changes} = pull!(@client, cursor)
      assert [%{id: run_id, deleted: true}] = changes.runs
      assert run_id == ids.run
      assert [%{player_id: player_id, deleted: true}] = changes.results
      assert player_id == ids.player
      assert changes.players == []
    end

    test "results can't be written to a deleted run" do
      ids = seed!(@client)
      push!(@client, [{"run.delete", %{id: ids.run}}], 4)

      assert %{rejections: [%{reason: "That drill was removed from the practice."}]} =
               push!(
                 @client,
                 [
                   {"result.set_value",
                    %{drill_run_id: ids.run, player_id: ids.player, value: 10}}
                 ],
                 5
               )
    end

    test "result.clear tombstones the result, and setting a value revives it" do
      ids = seed!(@client)
      key = %{drill_run_id: ids.run, player_id: ids.player}
      push!(@client, [{"result.set_value", Map.put(key, :value, 38)}, {"result.clear", key}], 4)

      assert %Result{deleted: true, value: nil} = Repo.get_by!(Result, drill_run_id: ids.run)

      push!(@client, [{"result.set_value", Map.put(key, :value, 41)}], 6)
      assert %Result{deleted: false, value: 41.0} = Repo.get_by!(Result, drill_run_id: ids.run)
    end
  end

  describe "pokes" do
    test "a push broadcasts a poke" do
      Phoenix.PubSub.subscribe(Courtside.PubSub, Sync.poke_topic())
      push!(@client, [{"player.put", %{id: uuid(), name: "Ana"}}])
      assert_receive :poke
    end
  end
end
