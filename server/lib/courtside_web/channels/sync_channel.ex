defmodule CourtsideWeb.SyncChannel do
  @moduledoc """
  Pokes: after every push commits, each client connected to that organization's
  topic (`sync:<organization_id>`) is told to pull. A poke carries no data, so a
  missed poke only delays a client until its next periodic pull.
  """
  use CourtsideWeb, :channel

  import Ecto.Query

  alias Courtside.Repo

  @impl true
  def join("sync:" <> org, _payload, socket) do
    if organization?(org) do
      Phoenix.PubSub.subscribe(Courtside.PubSub, Courtside.Sync.poke_topic(org))
      {:ok, socket}
    else
      {:error, %{reason: "unknown organization"}}
    end
  end

  @impl true
  def handle_info(:poke, socket) do
    push(socket, "poke", %{})
    {:noreply, socket}
  end

  defp organization?(org) do
    case Ecto.UUID.cast(org) do
      {:ok, id} ->
        Repo.exists?(from v in "org_versions", where: v.organization_id == type(^id, Ecto.UUID))

      :error ->
        false
    end
  end
end
