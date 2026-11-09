defmodule Courtside.Sync.Mutators do
  @moduledoc """
  Server-side mutations: the authoritative business rules. Each takes the
  client's args and the push's version, validates against current server state,
  and writes rows stamped with that version. Returns `:ok` or `{:error, reason}`
  where `reason` is shown to the coach.

  The client has matching mutators in `web/src/lib/sync/mutators.ts` so it can
  show results instantly; when the two disagree, the server wins.
  """

  import Ecto.Changeset
  import Ecto.Query

  alias Courtside.Repo
  alias Courtside.Practice.{Player, Drill, DrillRun, Result}

  # The arguments each mutation accepts. Anything else is refused rather than
  # silently dropped by `cast`, so a field name the client and server disagree
  # on fails loudly. Matches FIELDS in web/src/lib/sync/mutators.ts.
  @fields %{
    "player.put" => ~w(id name jersey active),
    "drill.put" => ~w(id name kind default_setup archived),
    "run.create" => ~w(id date drill_id setup),
    "run.set_setup" => ~w(id setup),
    "run.delete" => ~w(id),
    "result.set_value" => ~w(drill_run_id player_id value),
    "result.set_setup" => ~w(drill_run_id player_id setup),
    "result.clear" => ~w(drill_run_id player_id)
  }

  def run(name, args, v) do
    case @fields do
      %{^name => fields} ->
        # Args that aren't a map crash here, and Sync turns the crash into a rejection.
        case args |> Map.keys() |> Kernel.--(fields) |> Enum.sort() do
          [] -> dispatch(name, args, v)
          [field | _] -> {:error, "Unknown field: #{field}"}
        end

      _ ->
        {:error, "Unknown change type: #{name}"}
    end
  end

  defp dispatch("player.put", args, v), do: put_player(args, v)
  defp dispatch("drill.put", args, v), do: put_drill(args, v)
  defp dispatch("run.create", args, v), do: create_run(args, v)
  defp dispatch("run.set_setup", args, v), do: set_run_setup(args, v)
  defp dispatch("run.delete", args, v), do: delete_run(args, v)
  defp dispatch("result.set_value", args, v), do: set_result_value(args, v)
  defp dispatch("result.set_setup", args, v), do: set_result_setup(args, v)
  defp dispatch("result.clear", args, v), do: clear_result(args, v)

  # --- players and drills ---------------------------------------------------

  defp put_player(args, v) do
    (Repo.get(Player, args["id"]) || %Player{id: args["id"]})
    |> cast(args, [:name, :jersey, :active])
    |> update_change(:name, &String.trim/1)
    # cast turns "" into nil, but the column is NOT NULL.
    |> default_if_nil(:jersey, "")
    |> default_if_nil(:active, true)
    |> validate_required([:name])
    |> validate_length(:name, max: 100)
    |> put_change(:version, v)
    |> Repo.insert_or_update()
    |> to_result()
  end

  defp put_drill(args, v) do
    existing = Repo.get(Drill, args["id"])

    (existing || %Drill{id: args["id"]})
    |> cast(args, [:name, :kind, :default_setup, :archived])
    |> update_change(:name, &String.trim/1)
    |> validate_required([:name, :kind])
    |> validate_inclusion(:kind, Drill.kinds(), message: "must be makes, count or time")
    |> validate_kind_unchanged(existing)
    |> validate_setup(:default_setup)
    |> put_change(:version, v)
    |> check_constraint(:kind, name: :kind_valid)
    |> Repo.insert_or_update()
    |> to_result()
  end

  defp validate_kind_unchanged(cs, nil), do: cs

  defp validate_kind_unchanged(cs, %Drill{kind: kind}) do
    if get_field(cs, :kind) == kind,
      do: cs,
      else: add_error(cs, :kind, "can't change after the drill is created")
  end

  # --- runs -----------------------------------------------------------------

  defp create_run(args, v) do
    with {:ok, drill} <- fetch_live(Drill, args["drill_id"], "That drill no longer exists.") do
      %DrillRun{id: args["id"]}
      |> cast(args, [:date, :drill_id, :setup])
      |> validate_required([:date, :drill_id])
      |> validate_setup_for(drill.kind)
      |> put_change(:version, v)
      |> unique_constraint(:id, name: :drill_runs_pkey, message: "already exists")
      |> Repo.insert()
      |> to_result()
    end
  end

  defp set_run_setup(args, v) do
    with {:ok, run} <-
           fetch_live(DrillRun, args["id"], "That drill was removed from the practice."),
         drill = Repo.get!(Drill, run.drill_id),
         cs = run |> cast(args, [:setup]) |> validate_setup_for(drill.kind),
         :ok <- check_makes_fit(drill, run.id, get_field(cs, :setup)) do
      cs |> put_change(:version, v) |> Repo.update() |> to_result()
    end
  end

  # Makes can't exceed shots for any player who uses the run's setup.
  defp check_makes_fit(%Drill{kind: "makes"}, run_id, setup) do
    over =
      from(r in Result,
        join: p in assoc(r, :player),
        where:
          r.drill_run_id == ^run_id and not r.deleted and is_nil(r.setup) and r.value > ^setup,
        select: {p.name, r.value},
        limit: 1
      )
      |> Repo.one()

    case over do
      nil ->
        :ok

      {name, value} ->
        {:error, "#{name} has #{trunc(value)} makes, more than #{trunc(setup)} shots."}
    end
  end

  defp check_makes_fit(_drill, _run_id, _setup), do: :ok

  defp delete_run(%{"id" => id}, v) do
    case Repo.get(DrillRun, id) do
      nil ->
        :ok

      run ->
        now = DateTime.utc_now(:second)
        run |> change(deleted: true, version: v) |> Repo.update!()

        from(r in Result, where: r.drill_run_id == ^id and not r.deleted)
        |> Repo.update_all(set: [deleted: true, version: v, updated_at: now])

        :ok
    end
  end

  # --- results --------------------------------------------------------------

  defp set_result_value(args, v) do
    with {:ok, run, drill} <- fetch_run_and_drill(args),
         {:ok, _player} <-
           fetch_live(Player, args["player_id"], "That player is no longer on the roster."),
         result = get_result(run.id, args["player_id"]),
         {:ok, value} <- parse_value(drill.kind, args["value"], result.setup || run.setup) do
      result
      |> change(value: value, deleted: false, version: v)
      |> Repo.insert_or_update()
      |> to_result()
    end
  end

  defp set_result_setup(args, v) do
    with {:ok, run, drill} <- fetch_run_and_drill(args),
         {:ok, _player} <-
           fetch_live(Player, args["player_id"], "That player is no longer on the roster."),
         result = get_result(run.id, args["player_id"]),
         cs = result |> cast(args, [:setup]) |> validate_setup(:setup),
         :ok <- check_own_makes_fit(drill, result, get_field(cs, :setup) || run.setup) do
      # deleted: false revives a cleared result, so the override reaches clients.
      cs |> change(version: v, deleted: false) |> Repo.insert_or_update() |> to_result()
    end
  end

  defp check_own_makes_fit(%Drill{kind: "makes"}, %Result{value: value}, setup)
       when is_number(value) and is_number(setup) and value > setup,
       do: {:error, "#{trunc(value)} makes is more than #{trunc(setup)} shots."}

  defp check_own_makes_fit(_drill, _result, _setup), do: :ok

  defp clear_result(args, v) do
    case Repo.get_by(Result, drill_run_id: args["drill_run_id"], player_id: args["player_id"]) do
      nil ->
        :ok

      result ->
        result
        |> change(value: nil, setup: nil, deleted: true, version: v)
        |> Repo.update()
        |> to_result()
    end
  end

  defp get_result(run_id, player_id) do
    Repo.get_by(Result, drill_run_id: run_id, player_id: player_id) ||
      %Result{drill_run_id: run_id, player_id: player_id}
  end

  defp parse_value(_kind, value, _setup) when not is_number(value),
    do: {:error, "Enter a number."}

  defp parse_value(_kind, value, _setup) when value < 0,
    do: {:error, "Results can't be negative."}

  defp parse_value("makes", value, setup) do
    cond do
      value != trunc(value) ->
        {:error, "Makes must be a whole number."}

      is_number(setup) and value > setup ->
        {:error, "#{trunc(value)} makes is more than #{trunc(setup)} shots."}

      true ->
        {:ok, value / 1}
    end
  end

  defp parse_value("time", value, _setup) when value == 0,
    do: {:error, "Time must be above zero."}

  defp parse_value(_kind, value, _setup), do: {:ok, value / 1}

  # --- shared ---------------------------------------------------------------

  defp fetch_run_and_drill(args) do
    with {:ok, run} <-
           fetch_live(DrillRun, args["drill_run_id"], "That drill was removed from the practice.") do
      {:ok, run, Repo.get!(Drill, run.drill_id)}
    end
  end

  defp fetch_live(schema, id, message) do
    with {:ok, uuid} <- Ecto.UUID.cast(id || ""),
         %{deleted: false} = row <- Repo.get(schema, uuid) do
      {:ok, row}
    else
      _ -> {:error, message}
    end
  end

  defp validate_setup_for(cs, "makes"),
    do: cs |> validate_required([:setup], message: "shots are required") |> validate_setup(:setup)

  defp validate_setup_for(cs, _kind), do: validate_setup(cs, :setup)

  defp default_if_nil(cs, field, default) do
    if get_field(cs, field) == nil, do: put_change(cs, field, default), else: cs
  end

  defp validate_setup(cs, field), do: validate_number(cs, field, greater_than: 0)

  defp to_result({:ok, _}), do: :ok
  defp to_result({:error, %Ecto.Changeset{} = cs}), do: {:error, describe(cs)}

  defp describe(cs) do
    cs
    |> traverse_errors(fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, val}, acc ->
        String.replace(acc, "%{#{k}}", to_string(val))
      end)
    end)
    |> Enum.map_join("; ", fn {field, msgs} -> "#{humanize(field)} #{Enum.join(msgs, ", ")}" end)
  end

  defp humanize(field),
    do: field |> to_string() |> String.replace("_", " ") |> String.capitalize()
end
