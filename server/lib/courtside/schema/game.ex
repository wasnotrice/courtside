defmodule Courtside.Schema.Game do
  @moduledoc """
  One game played by a team against an opponent on a date. Keeps its own copy of the
  game rules, so changing a team's default never rewrites old games.

  Synced: carries `organization_id`, `version` and `deleted`.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "games" do
    field :team_id, :binary_id
    field :date, :date
    field :opponent, :string
    field :home_away, :string, default: "home"
    field :status, :string, default: "live"
    field :rules, :map
    field :official_us, :integer
    field :official_them, :integer
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
