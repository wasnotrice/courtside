defmodule Courtside.Schema.Drill do
  @moduledoc """
  A repeatable practice exercise with a fixed kind.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @kinds ~w(makes count time)
  def kinds, do: @kinds

  # The game stat a makes drill practices, for comparing practice with games.
  @game_stats ~w(ft fg2 fg3)
  def game_stats, do: @game_stats

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "drills" do
    field :program_id, :binary_id
    field :name, :string
    field :kind, :string
    field :default_setup, :float
    field :archived, :boolean, default: false
    field :game_stat, :string
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
