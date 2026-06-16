%%%-------------------------------------------------------------------
%% @doc ws_server public API
%% @end
%%%-------------------------------------------------------------------

-module(ws_server_app).

-behaviour(application).

-export([start/2, stop/1]).

start(_StartType, _StartArgs) ->
 Dispatch = cowboy_router:compile([
        {'_', [
            {"/", hello_handler, []},
             {"/ws", ws_handler, []}
        ]}
    ]),

    {ok, _} = cowboy:start_clear(
        http_listener,
        [{port, 8080}],
        #{env => #{dispatch => Dispatch}}
    ),
    ws_server_sup:start_link().

stop(_State) ->
    ok.

%% internal functions
