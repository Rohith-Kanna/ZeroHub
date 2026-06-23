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
    Port =
    case os:getenv("PORT") of
        false ->
            8080;
        Value ->
            list_to_integer(Value)
    end,

io:format("Starting ZeroHub on port ~p~n", [Port]),

    {ok, _} = cowboy:start_clear(
        websocket_listener,
        [{port, Port}],
        #{env => #{dispatch => Dispatch}}
    ),
    client_registry:start(),
    
    zerohub_backend_sup:start_link().

stop(_State) ->
    ok.

%% internal functions
