defmodule Courtside.Repo do
  use Ecto.Repo,
    otp_app: :courtside,
    adapter: Ecto.Adapters.SQLite3
end
