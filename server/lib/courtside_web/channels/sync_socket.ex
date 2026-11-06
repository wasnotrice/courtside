defmodule CourtsideWeb.SyncSocket do
  use Phoenix.Socket

  channel "sync", CourtsideWeb.SyncChannel

  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end

defmodule CourtsideWeb.SyncChannel do
  @moduledoc """
  Pokes: after every push commits, each connected client is told to pull.
  A poke carries no data, so a missed poke only delays a client until its next
  periodic pull.
  """
  use CourtsideWeb, :channel

  @impl true
  def join("sync", _payload, socket) do
    Phoenix.PubSub.subscribe(Courtside.PubSub, Courtside.Sync.poke_topic())
    {:ok, socket}
  end

  @impl true
  def handle_info(:poke, socket) do
    push(socket, "poke", %{})
    {:noreply, socket}
  end
end
