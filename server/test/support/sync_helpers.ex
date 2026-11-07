defmodule Courtside.SyncHelpers do
  @moduledoc """
  Builders for sync tests. Mutations use string keys, as they arrive from JSON.
  """

  alias Courtside.Sync

  def uuid, do: Ecto.UUID.generate()

  def mutation(id, name, args), do: %{"id" => id, "name" => name, "args" => stringify(args)}

  @doc "Pushes `{name, args}` pairs, numbering them from `first_id`."
  def push!(client_id, specs, first_id \\ 1) do
    mutations =
      specs
      |> Enum.with_index(first_id)
      |> Enum.map(fn {{name, args}, id} -> mutation(id, name, args) end)

    {:ok, result} = Sync.push(client_id, mutations)
    result
  end

  def pull!(client_id, cursor \\ 0) do
    {:ok, result} = Sync.pull(client_id, cursor)
    result
  end

  @doc "A player, a makes drill and a 50-shot run, ready for results."
  def seed!(client_id, opts \\ []) do
    ids = %{player: uuid(), drill: uuid(), run: uuid()}

    push!(client_id, [
      {"player.put", %{id: ids.player, name: "Ana", jersey: "4", active: true}},
      {"drill.put",
       %{
         id: ids.drill,
         name: "Free throws",
         kind: Keyword.get(opts, :kind, "makes"),
         default_setup: 50,
         archived: false
       }},
      {"run.create",
       %{
         id: ids.run,
         date: "2026-11-06",
         drill_id: ids.drill,
         setup: Keyword.get(opts, :setup, 50)
       }}
    ])

    ids
  end

  defp stringify(map), do: Map.new(map, fn {k, v} -> {to_string(k), v} end)
end
