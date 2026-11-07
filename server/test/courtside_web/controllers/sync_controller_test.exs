defmodule CourtsideWeb.SyncControllerTest do
  use CourtsideWeb.ConnCase, async: true

  import Courtside.SyncHelpers

  test "push then pull round-trips over JSON", %{conn: conn} do
    id = uuid()

    body = %{
      client_id: "phone",
      mutations: [
        %{id: 1, name: "player.put", args: %{id: id, name: "Ana", jersey: "4", active: true}},
        %{id: 2, name: "player.put", args: %{id: uuid(), name: ""}}
      ]
    }

    assert %{"last_mutation_id" => 2, "rejections" => [rejection]} =
             conn |> post(~p"/api/push", body) |> json_response(200)

    assert %{"mutation_id" => 2, "name" => "player.put", "args" => %{"name" => ""}, "reason" => _} =
             rejection

    pulled = build_conn() |> get(~p"/api/pull?client_id=phone&cursor=0") |> json_response(200)

    assert %{"cursor" => cursor, "last_mutation_id" => 2, "rejections" => [%{"mutation_id" => 2}]} =
             pulled

    assert is_integer(cursor) and cursor > 0
    assert [%{"id" => ^id, "name" => "Ana", "deleted" => false}] = pulled["changes"]["players"]
    assert %{"drills" => [], "runs" => [], "results" => []} = pulled["changes"]
  end

  test "cursor defaults to 0", %{conn: conn} do
    assert %{"cursor" => 0} = conn |> get(~p"/api/pull?client_id=phone") |> json_response(200)
  end

  test "rejects malformed requests", %{conn: conn} do
    assert %{"error" => _} = conn |> post(~p"/api/push", %{mutations: []}) |> json_response(400)

    assert %{"error" => _} =
             build_conn()
             |> post(~p"/api/push", %{
               client_id: "phone",
               mutations: [%{id: "1", name: "player.put"}]
             })
             |> json_response(400)

    assert %{"error" => _} =
             build_conn() |> get(~p"/api/pull?client_id=phone&cursor=-1") |> json_response(400)

    assert %{"error" => _} = build_conn() |> get(~p"/api/pull") |> json_response(400)
  end
end
