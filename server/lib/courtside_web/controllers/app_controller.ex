defmodule CourtsideWeb.AppController do
  @moduledoc """
  Serves the web app's `index.html` for every route the app handles in the browser
  (`/`, `/games/…`), so a reload or a shared link opens the app. The web build is
  copied into `priv/static` for releases; in dev, Vite serves the app instead.
  """
  use CourtsideWeb, :controller

  def index(conn, _params) do
    path = Application.app_dir(:courtside, "priv/static/index.html")

    if File.exists?(path) do
      conn
      # Always revalidate, so a new deploy's app is picked up.
      |> put_resp_header("cache-control", "no-cache")
      |> put_resp_content_type("text/html")
      |> send_file(200, path)
    else
      send_resp(conn, 404, "The web app isn't built into this server. In dev, use npm run dev.")
    end
  end

  def not_found(conn, _params), do: conn |> put_status(404) |> json(%{error: "Not found."})

  @doc "For Fly's health check: the server is up and can reach its database."
  def health(conn, _params) do
    Ecto.Adapters.SQL.query!(Courtside.Repo, "SELECT 1")
    send_resp(conn, 200, "ok")
  end
end
