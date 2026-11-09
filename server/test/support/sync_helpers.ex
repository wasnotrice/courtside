defmodule Courtside.SyncHelpers do
  @moduledoc """
  Builders for sync tests. Mutations use string keys, as they arrive from JSON.
  """

  alias Courtside.{Organizations, Sync}

  def uuid, do: Ecto.UUID.generate()

  def mutation(id, name, args), do: %{"id" => id, "name" => name, "args" => stringify(args)}

  @doc """
  Creates an organization with a girls' basketball program, a varsity team and
  the 2026–27 season, pushed by a setup client of its own. Returns their ids.
  """
  def org!(name \\ "Test High") do
    org = Organizations.create!(name).id
    ids = %{org: org, program: uuid(), team: uuid(), season: uuid()}

    push!(org, "setup-" <> org, [
      {"program.put", %{id: ids.program, name: "Girls' basketball", sport: "basketball"}},
      {"team.put", %{id: ids.team, program_id: ids.program, name: "Varsity"}},
      {"season.put",
       %{id: ids.season, name: "2026–27", starts_on: "2026-08-01", ends_on: "2027-07-31"}}
    ])

    ids
  end

  @doc "Pushes `{name, args}` pairs as `client`, numbering them from `first_id`."
  def push!(org, client, specs, first_id \\ 1) do
    mutations =
      specs
      |> Enum.with_index(first_id)
      |> Enum.map(fn {{name, args}, id} -> mutation(id, name, args) end)

    {:ok, result} = Sync.push(org, client, mutations)
    result
  end

  def pull!(org, client, cursor \\ 0) do
    {:ok, result} = Sync.pull(org, client, cursor)
    result
  end

  @doc """
  A player, a makes drill and a 50-shot run in the org's program, pushed by
  `client` as mutations 1 to 3. Returns `org` merged with their ids.
  """
  def seed!(org, client) do
    ids = Map.merge(org, %{player: uuid(), drill: uuid(), run: uuid()})

    push!(org.org, client, [
      {"player.put", %{id: ids.player, program_id: org.program, name: "Ana"}},
      {"drill.put",
       %{
         id: ids.drill,
         program_id: org.program,
         name: "Free throws",
         kind: "makes",
         default_setup: 50,
         archived: false
       }},
      {"run.create",
       %{id: ids.run, program_id: org.program, date: "2026-11-06", drill_id: ids.drill, setup: 50}}
    ])

    ids
  end

  def player(org, name \\ "Ana"), do: %{id: uuid(), program_id: org.program, name: name}

  defp stringify(map), do: Map.new(map, fn {k, v} -> {to_string(k), v} end)
end
