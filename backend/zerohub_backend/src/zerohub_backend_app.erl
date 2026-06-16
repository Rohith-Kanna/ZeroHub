%%%-------------------------------------------------------------------
%% @doc zerohub_backend public API
%% @end
%%%-------------------------------------------------------------------

-module(zerohub_backend_app).

-behaviour(application).

-export([start/2, stop/1]).

start(_StartType, _StartArgs) ->

      Dispatch = cowboy_router:compile([
        {'_', [
            {"/ws", ws_handler, []}
        ]}
    ]),

    {ok, _} = cowboy:start_clear(
        websocket_listener,
        [{port, 8080}],
        #{env => #{dispatch => Dispatch}}
    ),

    zerohub_backend_sup:start_link().

stop(_State) ->
    ok.

%% internal functions
