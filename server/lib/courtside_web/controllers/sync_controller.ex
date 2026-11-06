defmodule CourtsideWeb.SyncController do
  use CourtsideWeb, :controller

  alias Courtside.Sync

  def push(conn, %{"client_id" => client_id, "mutations" => mutations})
      when is_binary(client_id) and is_list(mutations) do
    if Enum.all?(mutations, &valid_mutation?/1) do
      {:ok, result} = Sync.push(client_id, mutations)
      json(conn, result)
    else
      bad_request(conn, "Each mutation needs an integer id, a name and an args object.")
    end
  end

  def push(conn, _params), do: bad_request(conn, "Send client_id and a list of mutations.")

  def pull(conn, %{"client_id" => client_id} = params) do
    case Integer.parse(Map.get(params, "cursor", "0")) do
      {cursor, ""} when cursor >= 0 ->
        {:ok, result} = Sync.pull(client_id, cursor)
        json(conn, result)

      _ ->
        bad_request(conn, "cursor must be a non-negative integer.")
    end
  end

  def pull(conn, _params), do: bad_request(conn, "Send client_id.")

  defp valid_mutation?(%{"id" => id, "name" => name} = m)
       when is_integer(id) and id > 0 and is_binary(name),
       do: is_map(Map.get(m, "args", %{}))

  defp valid_mutation?(_), do: false

  defp bad_request(conn, message) do
    conn |> put_status(:bad_request) |> json(%{error: message})
  end
end
