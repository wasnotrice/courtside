defmodule CourtsideWeb.SyncChannelTest do
  use CourtsideWeb.ChannelCase, async: true

  import Courtside.SyncHelpers

  test "a client joined to its organization's topic is poked after a push there" do
    org = org!()
    other = org!("Other High")

    {:ok, _, _socket} =
      CourtsideWeb.SyncSocket
      |> socket(nil, %{})
      |> subscribe_and_join(CourtsideWeb.SyncChannel, "sync:" <> org.org)

    push!(other.org, "client-b", [{"player.put", player(other)}])
    refute_push "poke", _, 50

    push!(org.org, "client-a", [{"player.put", player(org)}])
    assert_push "poke", %{}
  end

  test "joining an unknown organization's topic is refused" do
    assert {:error, %{reason: "unknown organization"}} =
             CourtsideWeb.SyncSocket
             |> socket(nil, %{})
             |> subscribe_and_join(CourtsideWeb.SyncChannel, "sync:" <> uuid())
  end
end
