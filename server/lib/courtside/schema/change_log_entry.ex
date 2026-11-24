defmodule Courtside.Schema.ChangeLogEntry do
  @moduledoc """
  One entry in the change log: a mutation the server handled, accepted or refused, and
  what it changed (`%{"field" => [before, after]}`). Never synced; read through
  `Courtside.Sync.history/4`.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  schema "change_log" do
    field :organization_id, :binary_id
    field :version, :integer
    field :client_id, :string
    field :mutation_id, :integer
    field :name, :string
    field :args, :map
    field :accepted, :boolean
    field :reason, :string
    field :row_table, :string
    field :row_key, :string
    field :changes, :map
    timestamps(type: :utc_datetime_usec, updated_at: false)
  end
end
