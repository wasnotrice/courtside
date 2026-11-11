defmodule Courtside.SharedMutationCasesTest do
  @moduledoc """
  Runs the shared mutation cases in spec/mutations/ through `Courtside.Sync.push/2`.
  The client runs the same files (web/src/lib/sync/shared-cases.test.ts), so a
  rule, argument or message that differs between the two fails one suite.
  """

  use Courtside.DataCase, async: true

  import Ecto.Query

  alias Courtside.{Organizations, Repo, Sync}

  alias Courtside.Schema.{
    Drill,
    DrillRun,
    Game,
    Play,
    Player,
    Program,
    Result,
    RosterEntry,
    Season,
    Team
  }

  @dir Path.expand("../../../spec/mutations", __DIR__)

  # Case table name, schema, and the fields a case's rows list. In insert order,
  # so foreign keys are satisfied.
  @tables [
    {"programs", Program, [:id, :name, :sport]},
    {"seasons", Season, [:id, :name, :starts_on, :ends_on]},
    {"teams", Team, [:id, :program_id, :name, :default_rules]},
    {"players", Player, [:id, :program_id, :name]},
    {"roster_entries", RosterEntry, [:id, :team_id, :season_id, :player_id, :jersey]},
    {"drills", Drill, [:id, :program_id, :name, :kind, :default_setup, :archived]},
    {"runs", DrillRun, [:id, :program_id, :date, :drill_id, :setup]},
    {"results", Result, [:drill_run_id, :player_id, :value, :setup]},
    {"games", Game,
     [:id, :team_id, :date, :opponent, :home_away, :status, :rules, :official_us, :official_them]},
    {"plays", Play,
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

  for file <- @dir |> Path.join("*.json") |> Path.wildcard() |> Enum.sort() do
    @external_resource file
    spec = file |> File.read!() |> Jason.decode!()
    given = Map.get(spec, "given", %{})

    describe Path.basename(file) do
      for c <- spec["cases"] do
        if reason = c["known_difference"] do
          @tag skip: "known difference: #{reason}"
        end

        test c["name"] do
          run_case(unquote(Macro.escape(given)), unquote(Macro.escape(c)))
        end
      end
    end
  end

  defp run_case(given, c) do
    org = Organizations.create!("Test").id
    extra = Map.get(c, "with", %{})

    for {table, schema, _fields} <- @tables,
        row <- Map.get(given, table, []) ++ Map.get(extra, table, []),
        do: insert!(schema, row, org)

    mutation = Map.put(c["mutation"], "id", 1)
    {:ok, %{rejections: rejections}} = Sync.push(org, Ecto.UUID.generate(), [mutation])

    case c["expect"] do
      %{"rejected" => message} ->
        assert [%{reason: ^message}] = rejections

      %{"rows" => tables} ->
        assert rejections == []

        for {table, rows} <- tables do
          assert sorted(table, live(table, org)) == sorted(table, rows), "#{table} differ"
        end
    end
  end

  # Rows go in as they'd be after earlier pushes, at version 1. cast converts
  # JSON values (dates, integers for float columns); empty_values: [] keeps "".
  defp insert!(schema, row, org) do
    fields = schema.__schema__(:fields) -- [:inserted_at, :updated_at]

    schema
    |> struct()
    |> Ecto.Changeset.cast(row, fields, empty_values: [])
    |> Ecto.Changeset.put_change(:organization_id, org)
    |> Ecto.Changeset.put_change(:version, 1)
    |> Repo.insert!()
  end

  # Live rows in the wire shape, minus version and deleted, with string keys.
  defp live(table, org) do
    {_name, schema, fields} = Enum.find(@tables, fn {name, _, _} -> name == table end)

    from(r in schema, where: r.organization_id == ^org and not r.deleted)
    |> Repo.all()
    |> Enum.map(fn row ->
      row
      |> Map.take(fields)
      |> Map.new(fn
        {k, %Date{} = d} -> {to_string(k), Date.to_iso8601(d)}
        {k, v} -> {to_string(k), v}
      end)
    end)
  end

  # Elixir's == treats 50 and 50.0 as equal, so JSON integers match float columns.
  defp sorted("results", rows), do: Enum.sort_by(rows, &{&1["drill_run_id"], &1["player_id"]})
  defp sorted(_table, rows), do: Enum.sort_by(rows, & &1["id"])
end
