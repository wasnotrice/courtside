defmodule Courtside.SyncTest do
  @moduledoc """
  The push/pull protocol. The rules each mutation enforces are covered by the
  shared cases in spec/mutations/ (see shared_mutation_cases_test.exs).
  """
  use Courtside.DataCase, async: true

  import Courtside.SyncHelpers
  import ExUnit.CaptureLog

  alias Courtside.{Organizations, Sync}
  alias Courtside.Schema.{DrillRun, Player, Result}

  @client "client-a"

  setup do
    %{org: org!()}
  end

  describe "push" do
    test "replaying the same push is a no-op", %{org: org} do
      p = player(org)

      assert %{last_mutation_id: 1, rejections: []} = push!(org.org, @client, [{"player.put", p}])
      version = Repo.get!(Player, p.id).version

      assert %{last_mutation_id: 1, rejections: []} = push!(org.org, @client, [{"player.put", p}])
      assert Repo.get!(Player, p.id).version == version
      assert Repo.aggregate(Player, :count) == 1
    end

    test "a retried batch applies only the mutations the server hasn't seen", %{org: org} do
      a = player(org, "Ana")
      b = player(org, "Bea")
      push!(org.org, @client, [{"player.put", a}])

      result =
        push!(org.org, @client, [
          {"player.put", %{a | name: "Changed on retry"}},
          {"player.put", b}
        ])

      assert result.last_mutation_id == 2
      assert Repo.get!(Player, a.id).name == "Ana"
      assert Repo.get!(Player, b.id).name == "Bea"
    end

    test "a rejected mutation is recorded and returned, and later mutations still apply",
         %{org: org} do
      good = player(org, "Bea")

      result =
        push!(org.org, @client, [
          {"player.put", %{player(org) | name: "   "}},
          {"player.put", good}
        ])

      assert %{last_mutation_id: 2, rejections: [rejection]} = result
      assert %{mutation_id: 1, name: "player.put", reason: "Name can't be blank"} = rejection
      assert Repo.get!(Player, good.id).name == "Bea"
      assert Repo.aggregate(Player, :count) == 1

      # Recorded, so a pull from before the push reports it too.
      assert [%{mutation_id: 1}] = pull!(org.org, @client).rejections
    end

    test "a crashing mutation is rejected without failing the push", %{org: org} do
      good = player(org, "Bea")

      {result, log} =
        with_log(fn ->
          push!(org.org, @client, [
            {"player.put", %{player(org) | id: "not-a-uuid"}},
            {"player.put", good}
          ])
        end)

      assert log =~ "Mutation player.put crashed"
      assert %{last_mutation_id: 2, rejections: [%{mutation_id: 1, reason: reason}]} = result
      assert reason =~ "could not apply"
      assert Repo.get!(Player, good.id)
    end

    test "a mutation that trips a database constraint is rejected and the transaction recovers",
         %{org: org} do
      ids = seed!(org, @client)

      # Postgres refuses NUL bytes in text and Elixir doesn't check for them, so
      # this raises inside the savepoint. The push must roll back to it and go on.
      {result, _log} =
        with_log(fn ->
          push!(
            org.org,
            @client,
            [
              {"player.put", player(org, "Cam\u0000")},
              {"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 10}}
            ],
            4
          )
        end)

      assert %{last_mutation_id: 5, rejections: [%{mutation_id: 4}]} = result
      assert Repo.get_by!(Result, drill_run_id: ids.run).value == 10.0
    end

    test "every row a push writes carries that push's version", %{org: org} do
      ids = seed!(org, @client)
      version = Repo.get!(Player, ids.player).version

      assert Repo.get!(DrillRun, ids.run).version == version
      assert pull!(org.org, @client).cursor == version
    end

    test "more than the maximum number of mutations is refused before anything runs",
         %{org: org} do
      specs = for _ <- 1..(Sync.max_mutations() + 1), do: {"player.put", player(org)}

      mutations =
        specs |> Enum.with_index(1) |> Enum.map(fn {{n, a}, i} -> mutation(i, n, a) end)

      assert {:error, :too_many_mutations} = Sync.push(org.org, @client, mutations)
      assert Repo.aggregate(Player, :count) == 0
    end
  end

  describe "organizations" do
    test "each organization has its own version counter", %{org: org} do
      other = org!("Other High")
      before = pull!(org.org, "observer").cursor

      push!(other.org, "client-b", [{"player.put", player(other)}])

      assert pull!(org.org, "observer").cursor == before
      assert pull!(other.org, "observer-b").cursor > 0
    end

    test "pull returns only the organization's rows", %{org: org} do
      other = org!("Other High")
      push!(org.org, @client, [{"player.put", player(org, "Ana")}])
      push!(other.org, "client-b", [{"player.put", player(other, "Bea")}])

      assert [%{name: "Ana"}] = pull!(org.org, "observer").changes.players
      assert [%{name: "Bea"}] = pull!(other.org, "observer-b").changes.players
    end

    test "rows in another organization are invisible", %{org: org} do
      other = org!("Other High")
      ids = seed!(other, "client-b")

      assert %{rejections: [%{reason: "That drill was removed from the practice."}]} =
               push!(org.org, @client, [{"run.set_setup", %{id: ids.run, setup: 40}}])

      # Creating a row with its id is refused, without saying the id is taken,
      # rather than taking the row over.
      assert %{rejections: [%{reason: "The server could not apply this change."}]} =
               push!(
                 org.org,
                 @client,
                 [{"player.put", %{id: ids.player, program_id: org.program, name: "Mine"}}],
                 2
               )

      assert Repo.get!(Player, ids.player).name == "Ana"
    end

    test "a client id belongs to the organization it first used", %{org: org} do
      other = org!("Other High")
      push!(org.org, @client, [{"player.put", player(org)}])

      assert {:error, :wrong_organization} =
               Sync.push(other.org, @client, [mutation(2, "player.put", player(other))])

      assert {:error, :wrong_organization} = Sync.pull(other.org, @client, 0)
    end

    test "an unknown organization is refused" do
      assert {:error, :unknown_organization} = Sync.push(uuid(), @client, [])
      assert {:error, :unknown_organization} = Sync.pull(uuid(), @client, 0)
      assert {:error, :unknown_organization} = Sync.pull("not-a-uuid", @client, 0)
    end
  end

  describe "pull" do
    test "cursor 0 returns everything, and the returned cursor returns nothing new",
         %{org: org} do
      ids = seed!(org, @client)

      push!(
        org.org,
        @client,
        [{"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 38}}],
        4
      )

      first = pull!(org.org, "another-client")
      assert [%{name: "Girls' basketball", sport: "basketball"}] = first.changes.programs
      assert [%{name: "Varsity"}] = first.changes.teams
      assert [%{name: "2026–27", starts_on: "2026-08-01"}] = first.changes.seasons
      assert [%{id: player_id, name: "Ana", deleted: false}] = first.changes.players
      assert player_id == ids.player
      assert [%{kind: "makes", default_setup: 50.0}] = first.changes.drills
      assert [%{date: "2026-11-06", setup: 50.0}] = first.changes.runs
      assert [%{value: 38.0, setup: nil}] = first.changes.results
      assert first.last_mutation_id == 0

      second = pull!(org.org, "another-client", first.cursor)
      assert second.cursor == first.cursor
      assert Enum.all?(second.changes, fn {_table, rows} -> rows == [] end)
    end

    test "results are keyed by run and player, without the server's id", %{org: org} do
      ids = seed!(org, @client)

      push!(
        org.org,
        @client,
        [{"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 38}}],
        4
      )

      [result] = pull!(org.org, @client).changes.results

      assert Map.keys(result) |> Enum.sort() == [
               :deleted,
               :drill_run_id,
               :player_id,
               :setup,
               :value,
               :version
             ]
    end

    test "reports the client's last_mutation_id", %{org: org} do
      seed!(org, @client)
      assert pull!(org.org, @client).last_mutation_id == 3
    end

    test "only reports rejections recorded after the cursor", %{org: org} do
      push!(org.org, @client, [{"player.put", %{player(org) | name: ""}}])
      %{cursor: cursor, rejections: [_]} = pull!(org.org, @client)

      assert pull!(org.org, @client, cursor).rejections == []
    end

    test "returns the data id, which changes when the data is restored", %{org: org} do
      %{data_id: data_id} = pull!(org.org, @client)
      assert {:ok, _} = Ecto.UUID.cast(data_id)
      assert pull!(org.org, @client).data_id == data_id

      Organizations.new_data_id!(org.org)
      assert pull!(org.org, @client).data_id != data_id
    end
  end

  describe "deletes" do
    test "run.delete tombstones the run and its results, and pull reports them", %{org: org} do
      ids = seed!(org, @client)

      push!(
        org.org,
        @client,
        [{"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 38}}],
        4
      )

      %{cursor: cursor} = pull!(org.org, @client)

      push!(org.org, @client, [{"run.delete", %{id: ids.run}}], 5)

      %{changes: changes} = pull!(org.org, @client, cursor)
      assert [%{id: run_id, deleted: true}] = changes.runs
      assert run_id == ids.run
      assert [%{player_id: player_id, deleted: true}] = changes.results
      assert player_id == ids.player
      assert changes.players == []
    end

    test "result.clear tombstones the result, and setting a value revives it", %{org: org} do
      ids = seed!(org, @client)
      key = %{drill_run_id: ids.run, player_id: ids.player}

      push!(
        org.org,
        @client,
        [{"result.set_value", Map.put(key, :value, 38)}, {"result.clear", key}],
        4
      )

      assert %Result{deleted: true, value: nil} = Repo.get_by!(Result, drill_run_id: ids.run)

      push!(org.org, @client, [{"result.set_value", Map.put(key, :value, 41)}], 6)
      assert %Result{deleted: false, value: 41.0} = Repo.get_by!(Result, drill_run_id: ids.run)
    end
  end

  describe "pokes" do
    test "a push pokes only its own organization", %{org: org} do
      other = org!("Other High")
      Phoenix.PubSub.subscribe(Courtside.PubSub, Sync.poke_topic(org.org))

      push!(other.org, "client-b", [{"player.put", player(other)}])
      refute_receive :poke, 50

      push!(org.org, @client, [{"player.put", player(org)}])
      assert_receive :poke
    end
  end

  describe "change log" do
    test "records each accepted change with its before and after values", %{org: org} do
      ids = seed!(org, @client)
      key = %{drill_run_id: ids.run, player_id: ids.player}
      push!(org.org, @client, [{"result.set_value", Map.put(key, :value, 38)}], 4)
      push!(org.org, "client-b", [{"result.set_value", Map.put(key, :value, 41)}])

      {:ok, [latest, first]} = Sync.history(org.org, "results", "#{ids.run}/#{ids.player}")

      assert %{client_id: "client-b", accepted: true, changes: %{"value" => [38.0, 41.0]}} =
               latest

      assert %{client_id: @client, mutation_id: 4, changes: %{"value" => [nil, 38.0]}} = first
      assert latest.version > first.version
    end

    test "a new row's fields start from nil, and an edit lists only what changed", %{org: org} do
      p = player(org, "Ana")
      push!(org.org, @client, [{"player.put", p}, {"player.put", %{id: p.id, name: "Ana B"}}])

      {:ok, [rename, create]} = Sync.history(org.org, "players", p.id)
      assert rename.changes == %{"name" => ["Ana", "Ana B"]}
      assert create.changes == %{"name" => [nil, "Ana"], "program_id" => [nil, org.program]}
    end

    test "refused changes are logged against the row they named, with the reason", %{org: org} do
      p = player(org, "Ana")
      push!(org.org, @client, [{"player.put", p}, {"player.put", %{id: p.id, name: " "}}])

      {:ok, [refused, _created]} = Sync.history(org.org, "players", p.id)
      assert %{accepted: false, reason: "Name can't be blank", changes: nil} = refused
    end

    test "deleting a drill run logs how many results went with it", %{org: org} do
      ids = seed!(org, @client)

      push!(
        org.org,
        @client,
        [
          {"result.set_value", %{drill_run_id: ids.run, player_id: ids.player, value: 38}},
          {"run.delete", %{id: ids.run}}
        ],
        4
      )

      {:ok, [delete | _]} = Sync.history(org.org, "runs", ids.run)
      assert delete.changes == %{"deleted" => [false, true], "results_deleted" => [0, 1]}
    end

    test "history is limited to its organization", %{org: org} do
      other = org!("Other High")
      p = player(org)
      push!(org.org, @client, [{"player.put", p}])

      assert {:ok, [_]} = Sync.history(org.org, "players", p.id)
      assert {:ok, []} = Sync.history(other.org, "players", p.id)
      assert {:error, :unknown_organization} = Sync.history(uuid(), "players", p.id)
    end
  end
end
