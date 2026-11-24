defmodule Courtside.Schema.Client do
  @moduledoc """
  A device's sync identity and the last mutation the server processed for it. A client
  id belongs to one organization. Not synced.
  """
  use Ecto.Schema

  @primary_key {:id, :string, autogenerate: false}
  schema "clients" do
    field :organization_id, :binary_id
    field :last_mutation_id, :integer, default: 0
    timestamps(type: :utc_datetime)
  end
end
