defmodule CourtsideWeb.SyncController do
  use CourtsideWeb, :controller

  alias Courtside.Sync

  def push(conn, %{"organization_id" => org, "client_id" => client_id, "mutations" => mutations})
      when is_binary(org) and is_binary(client_id) and is_list(mutations) do
    if Enum.all?(mutations, &valid_mutation?/1) do
      respond(conn, Sync.push(org, client_id, mutations))
    else
      bad_request(conn, "Each mutation needs an integer id, a name and an args object.")
    end
  end

  def push(conn, _params),
    do: bad_request(conn, "Send organization_id, client_id and a list of mutations.")

  def pull(conn, %{"organization_id" => org, "client_id" => client_id} = params)
      when is_binary(org) and is_binary(client_id) do
    case Integer.parse(Map.get(params, "cursor", "0")) do
      {cursor, ""} when cursor >= 0 -> respond(conn, Sync.pull(org, client_id, cursor))
      _ -> bad_request(conn, "cursor must be a non-negative integer.")
    end
  end

  def pull(conn, _params), do: bad_request(conn, "Send organization_id and client_id.")

  # These are HTTP errors, never rejections: the client keeps its queue and retries.
  defp respond(conn, {:ok, result}), do: json(conn, result)

  defp respond(conn, {:error, :unknown_organization}),
    do: error(conn, :not_found, "Unknown organization.")

  defp respond(conn, {:error, :wrong_organization}),
    do: error(conn, :forbidden, "That client belongs to another organization.")

  defp respond(conn, {:error, :too_many_mutations}),
    do:
      error(
        conn,
        :request_entity_too_large,
        "Send at most #{Sync.max_mutations()} mutations per push."
      )

  defp valid_mutation?(%{"id" => id, "name" => name} = m)
       when is_integer(id) and id > 0 and is_binary(name),
       do: is_map(Map.get(m, "args", %{}))

  defp valid_mutation?(_), do: false

  defp bad_request(conn, message), do: error(conn, :bad_request, message)

  defp error(conn, status, message), do: conn |> put_status(status) |> json(%{error: message})
end
