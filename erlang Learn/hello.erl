-module(hello).

-export([start/0]).

start() ->
    spawn(fun loop/0).

loop() ->
    receive
        Msg ->
            io:format("Got message: ~p~n", [Msg]),
            loop()
    end.