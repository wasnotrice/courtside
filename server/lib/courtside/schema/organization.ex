defmodule Courtside.Schema.Organization do
  @moduledoc """
  A school. Everything in Courtside belongs to exactly one organization. Not synced.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "organizations" do
    field :name, :string
    timestamps(type: :utc_datetime)
  end
end
