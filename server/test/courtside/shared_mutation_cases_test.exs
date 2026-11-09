defmodule Courtside.SharedMutationCasesTest do
  @moduledoc """
  Runs the shared mutation cases in spec/mutations/ through `Courtside.Sync.push/2`.
  The client runs the same files (web/src/lib/sync/shared-cases.test.ts), so a
  rule, argument or message that differs between the two fails one suite.
  """

  use Courtside.DataCase, async: true

  import Ecto.Query

  alias Courtside.{Repo, Sync}
  alias Courtside.Practice.{Player, Drill, DrillRun, Result}

  @dir Path.expand("../../../spec/mutations", __DIR__)
  @tables ~w(players drills runs results)

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
    extra = Map.get(c, "with", %{})

    for table <- @tables,
        row <- Map.get(given, table, []) ++ Map.get(extra, table, []),
        do: insert!(table, row)

    mutation = Map.put(c["mutation"], "id", 1)
    {:ok, %{rejections: rejections}} = Sync.push(Ecto.UUID.generate(), [mutation])

    case c["expect"] do
      %{"rejected" => message} ->
        assert [%{reason: ^message}] = rejections

      %{"rows" => tables} ->
        assert rejections == []

        for {table, rows} <- tables do
          assert sorted(table, live(table)) == sorted(table, rows), "#{table} differ"
        end
    end
  end

  # Rows go in as they'd be after earlier pushes, at version 1.
  defp insert!("players", r),
    do:
      Repo.insert!(%Player{
        id: r["id"],
        name: r["name"],
        jersey: r["jersey"],
        active: r["active"],
        deleted: r["deleted"] || false,
        version: 1
      })

  defp insert!("drills", r),
    do:
      Repo.insert!(%Drill{
        id: r["id"],
        name: r["name"],
        kind: r["kind"],
        default_setup: float(r["default_setup"]),
        archived: r["archived"],
        deleted: r["deleted"] || false,
        version: 1
      })

  defp insert!("runs", r),
    do:
      Repo.insert!(%DrillRun{
        id: r["id"],
        date: Date.from_iso8601!(r["date"]),
        drill_id: r["drill_id"],
        setup: float(r["setup"]),
        deleted: r["deleted"] || false,
        version: 1
      })

  defp insert!("results", r),
    do:
      Repo.insert!(%Result{
        drill_run_id: r["drill_run_id"],
        player_id: r["player_id"],
        value: float(r["value"]),
        setup: float(r["setup"]),
        deleted: r["deleted"] || false,
        version: 1
      })

  defp float(nil), do: nil
  defp float(n), do: n / 1

  # Live rows in the wire shape, minus version and deleted, with string keys.
  defp live(table) do
    {schema, fields} =
      case table do
        "players" -> {Player, [:id, :name, :jersey, :active]}
        "drills" -> {Drill, [:id, :name, :kind, :default_setup, :archived]}
        "runs" -> {DrillRun, [:id, :date, :drill_id, :setup]}
        "results" -> {Result, [:drill_run_id, :player_id, :value, :setup]}
      end

    from(r in schema, where: not r.deleted)
    |> Repo.all()
    |> Enum.map(fn row ->
      row
      |> Map.take(fields)
      |> Map.new(fn
        {:date, d} -> {"date", Date.to_iso8601(d)}
        {k, v} -> {to_string(k), v}
      end)
    end)
  end

  # Elixir's == treats 50 and 50.0 as equal, so JSON integers match float columns.
  defp sorted("results", rows), do: Enum.sort_by(rows, &{&1["drill_run_id"], &1["player_id"]})
  defp sorted(_table, rows), do: Enum.sort_by(rows, & &1["id"])
end
