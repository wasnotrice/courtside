defmodule Courtside.Schema.MutationRejection do
  @moduledoc """
  A mutation the server refused, with the reason. Pull reports it to the client that
  sent it. Not synced.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  schema "mutation_rejections" do
    field :client_id, :string
    field :mutation_id, :integer
    field :name, :string
    field :args, :map
    field :reason, :string
    field :version, :integer
    timestamps(type: :utc_datetime, updated_at: false)
  end
end
