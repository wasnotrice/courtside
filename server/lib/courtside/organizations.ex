defmodule Courtside.Organizations do
  @moduledoc """
  Creating organizations. Each has a row in `org_versions` holding its version
  counter and its data id (see `Courtside.Sync`).
  """

  import Ecto.Query

  alias Courtside.Repo
  alias Courtside.Schema.Organization

  @doc "Creates an organization and its version counter."
  def create!(name, id \\ Ecto.UUID.generate()) do
    {:ok, org} =
      Repo.transaction(fn ->
        org = Repo.insert!(%Organization{id: id, name: name})
        Repo.insert_all("org_versions", [%{organization_id: Ecto.UUID.dump!(id)}])
        org
      end)

    org
  end

  @doc """
  Gives the organization's data a new id. Run it after restoring a backup:
  phones then pull from scratch instead of trusting cursors that may point past
  the restored data.
  """
  def new_data_id!(id) do
    {1, _} =
      Repo.update_all(from(v in "org_versions", where: v.organization_id == type(^id, Ecto.UUID)),
        set: [data_id: Ecto.UUID.bingenerate()]
      )

    :ok
  end
end
