defmodule CourtsideWeb.SyncControllerTest do
  use CourtsideWeb.ConnCase, async: true

  import Courtside.SyncHelpers

  alias Courtside.Sync

  setup do
    %{org: org!()}
  end

  test "push then pull round-trips over JSON", %{conn: conn, org: org} do
    p = player(org)

    body = %{
      organization_id: org.org,
      client_id: "phone",
      mutations: [
        %{id: 1, name: "player.put", args: p},
        %{id: 2, name: "player.put", args: %{p | id: uuid(), name: ""}}
      ]
    }

    assert %{"last_mutation_id" => 2, "rejections" => [rejection]} =
             conn |> post(~p"/api/push", body) |> json_response(200)

    assert %{"mutation_id" => 2, "name" => "player.put", "args" => %{"name" => ""}, "reason" => _} =
             rejection

    pulled =
      build_conn()
      |> get(~p"/api/pull?organization_id=#{org.org}&client_id=phone&cursor=0")
      |> json_response(200)

    assert %{
             "cursor" => cursor,
             "data_id" => data_id,
             "last_mutation_id" => 2,
             "rejections" => [%{"mutation_id" => 2}]
           } = pulled

    assert is_integer(cursor) and cursor > 0
    assert is_binary(data_id)
    id = p.id
    assert [%{"id" => ^id, "name" => "Ana", "deleted" => false}] = pulled["changes"]["players"]

    assert %{"drills" => [], "runs" => [], "results" => [], "roster_entries" => []} =
             pulled["changes"]
  end

  test "cursor defaults to 0", %{conn: conn} do
    other = Courtside.Organizations.create!("Empty High")

    assert %{"cursor" => 0} =
             conn
             |> get(~p"/api/pull?organization_id=#{other.id}&client_id=phone")
             |> json_response(200)
  end

  test "rejects malformed requests", %{conn: conn, org: org} do
    assert %{"error" => _} = conn |> post(~p"/api/push", %{mutations: []}) |> json_response(400)

    assert %{"error" => _} =
             build_conn()
             |> post(~p"/api/push", %{
               organization_id: org.org,
               client_id: "phone",
               mutations: [%{id: "1", name: "player.put"}]
             })
             |> json_response(400)

    assert %{"error" => _} =
             build_conn()
             |> get(~p"/api/pull?organization_id=#{org.org}&client_id=phone&cursor=-1")
             |> json_response(400)

    assert %{"error" => _} =
             build_conn() |> get(~p"/api/pull?client_id=phone") |> json_response(400)
  end

  # HTTP errors, never rejections: the phone keeps its queue and retries.
  test "organization and size problems are HTTP errors", %{conn: conn, org: org} do
    assert %{"error" => "Unknown organization."} =
             conn
             |> get(~p"/api/pull?organization_id=#{uuid()}&client_id=phone")
             |> json_response(404)

    build_conn()
    |> post(~p"/api/push", %{organization_id: org.org, client_id: "phone", mutations: []})
    |> json_response(200)

    other = org!("Other High")

    assert %{"error" => _} =
             build_conn()
             |> get(~p"/api/pull?organization_id=#{other.org}&client_id=phone")
             |> json_response(403)

    too_many =
      for i <- 1..(Sync.max_mutations() + 1),
          do: %{id: i, name: "player.put", args: player(org)}

    assert %{"error" => _} =
             build_conn()
             |> post(~p"/api/push", %{
               organization_id: org.org,
               client_id: "phone",
               mutations: too_many
             })
             |> json_response(413)
  end

  test "allowed origins get CORS headers, others don't", %{org: org} do
    preflight =
      build_conn()
      |> put_req_header("origin", "tauri://localhost")
      |> options(~p"/api/push")

    assert preflight.status == 204
    assert get_resp_header(preflight, "access-control-allow-origin") == ["tauri://localhost"]

    other =
      build_conn()
      |> put_req_header("origin", "https://evil.example")
      |> get(~p"/api/pull?organization_id=#{org.org}&client_id=phone")

    assert get_resp_header(other, "access-control-allow-origin") == []
  end
end
