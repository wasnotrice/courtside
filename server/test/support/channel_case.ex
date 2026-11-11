defmodule CourtsideWeb.ChannelCase do
  @moduledoc """
  The test case for channel tests, with the SQL sandbox set up.
  """
  use ExUnit.CaseTemplate

  using do
    quote do
      import Phoenix.ChannelTest
      import CourtsideWeb.ChannelCase

      @endpoint CourtsideWeb.Endpoint
    end
  end

  setup tags do
    Courtside.DataCase.setup_sandbox(tags)
    :ok
  end
end
