defmodule Courtside.Practice do
  @moduledoc """
  Schemas for the synced practice data. Every row carries `version` (the global
  version of the push that last changed it) and `deleted` (a tombstone, so pulls
  can tell clients a row is gone).
  """

  defmodule Player do
    use Ecto.Schema

    @primary_key {:id, :binary_id, autogenerate: false}
    schema "players" do
      field :name, :string
      field :jersey, :string, default: ""
      field :active, :boolean, default: true
      field :version, :integer
      field :deleted, :boolean, default: false
      timestamps(type: :utc_datetime)
    end
  end

  defmodule Drill do
    use Ecto.Schema

    @kinds ~w(makes count time)
    def kinds, do: @kinds

    @primary_key {:id, :binary_id, autogenerate: false}
    schema "drills" do
      field :name, :string
      field :kind, :string
      field :default_setup, :float
      field :archived, :boolean, default: false
      field :version, :integer
      field :deleted, :boolean, default: false
      timestamps(type: :utc_datetime)
    end
  end

  defmodule DrillRun do
    use Ecto.Schema

    @primary_key {:id, :binary_id, autogenerate: false}
    @foreign_key_type :binary_id
    schema "drill_runs" do
      field :date, :date
      belongs_to :drill, Courtside.Practice.Drill
      field :setup, :float
      field :version, :integer
      field :deleted, :boolean, default: false
      timestamps(type: :utc_datetime)
    end
  end

  defmodule Result do
    use Ecto.Schema

    @primary_key {:id, :binary_id, autogenerate: true}
    @foreign_key_type :binary_id
    schema "results" do
      belongs_to :drill_run, Courtside.Practice.DrillRun
      belongs_to :player, Courtside.Practice.Player
      field :value, :float
      field :setup, :float
      field :version, :integer
      field :deleted, :boolean, default: false
      timestamps(type: :utc_datetime)
    end
  end
end
