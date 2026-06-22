-module(client_registry).

-export([
    start/0,
    add/1,
    remove/1,
    get_clients/0
]).

start() ->
   case ets:info(clients) of
        undefined ->
            ets:new(clients, [named_table, public, set]),
            ok;
        _ ->
            ok
    end.
    
add(Pid) ->
    ets:insert(clients, {Pid}).

remove(Pid) ->
    ets:delete(clients, Pid).

get_clients() ->
    [Pid || {Pid} <- ets:tab2list(clients)].