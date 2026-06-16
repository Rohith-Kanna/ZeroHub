-module(erlangLearn).

-export([start/0]).

start() ->
    spawn(fun() ->
        io:format("I am a process!~n")
    end).