defmodule CourtsideWeb.AppControllerTest do
  use CourtsideWeb.ConnCase, async: true

  test "the health check answers", %{conn: conn} do
    assert conn |> get("/api/health") |> response(200) == "ok"
  end

  test "an unknown API path is a JSON 404, not the web app", %{conn: conn} do
    assert %{"error" => "Not found."} = conn |> get("/api/nope") |> json_response(404)
    assert conn |> post("/api/nope", %{}) |> json_response(404)
  end

  test "any other path is a route of the web app", %{conn: conn} do
    # The web build isn't in priv/static in tests, so this is the not-built message.
    assert conn |> get("/games/123") |> response(404) =~ "isn't built"
  end
end
