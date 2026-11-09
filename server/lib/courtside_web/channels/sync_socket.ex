defmodule CourtsideWeb.SyncSocket do
  use Phoenix.Socket

  channel "sync:*", CourtsideWeb.SyncChannel

  # Once sign-in exists, connect/3 checks the device token here.
  @impl true
  def connect(_params, socket, _connect_info), do: {:ok, socket}

  @impl true
  def id(_socket), do: nil
end
