defmodule CourtsideWeb.Plugs.CORS do
  @moduledoc """
  Lets the app call the API from another origin, such as the Tauri app's
  (phase 3). Only origins listed in `config :courtside, :cors_origins` get the
  headers; everyone else is left to the browser's same-origin rules.
  """
  import Plug.Conn

  def init(opts), do: opts

  def call(conn, _opts) do
    origin = conn |> get_req_header("origin") |> List.first()

    if origin && origin in Application.get_env(:courtside, :cors_origins, []) do
      conn
      |> put_resp_header("access-control-allow-origin", origin)
      |> put_resp_header("vary", "origin")
      |> preflight()
    else
      conn
    end
  end

  defp preflight(%{method: "OPTIONS"} = conn) do
    conn
    |> put_resp_header("access-control-allow-methods", "GET, POST, OPTIONS")
    |> put_resp_header("access-control-allow-headers", "content-type, authorization")
    |> put_resp_header("access-control-max-age", "86400")
    |> send_resp(204, "")
    |> halt()
  end

  defp preflight(conn), do: conn
end
