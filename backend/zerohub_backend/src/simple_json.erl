-module(simple_json).
-export([parse/1, encode/1]).

parse(Bin) when is_binary(Bin) ->
    {Val, _} = val(skip_ws(Bin)),
    Val.

val(<<"true", Rest/binary>>) -> {true, Rest};
val(<<"false", Rest/binary>>) -> {false, Rest};
val(<<"null", Rest/binary>>) -> {null, Rest};
val(<<"\"", Rest/binary>>) -> string_val(Rest, <<>>);
val(<<"[", Rest/binary>>) -> array_val(skip_ws(Rest), []);
val(<<"{", Rest/binary>>) -> object_val(skip_ws(Rest), #{});
val(Bin) ->
    case number_val(Bin) of
        {ok, Num, Rest} -> {Num, Rest};
        error -> error({bad_json, Bin})
    end.

skip_ws(<<C, Rest/binary>>) when C == $\s; C == $\t; C == $\r; C == $\n -> skip_ws(Rest);
skip_ws(Bin) -> Bin.

string_val(<<"\\\"", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $">>);
string_val(<<"\\\\", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $\\>>);
string_val(<<"\\/", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $/>>);
string_val(<<"\\b", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $\b>>);
string_val(<<"\\f", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $\f>>);
string_val(<<"\\n", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $\n>>);
string_val(<<"\\r", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $\r>>);
string_val(<<"\\t", Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, $\t>>);
string_val(<<"\"", Rest/binary>>, Acc) -> {Acc, Rest};
string_val(<<C, Rest/binary>>, Acc) -> string_val(Rest, <<Acc/binary, C>>).

array_val(<<"]", Rest/binary>>, Acc) -> {lists:reverse(Acc), Rest};
array_val(Bin, Acc) ->
    {Val, Rest} = val(Bin),
    case skip_ws(Rest) of
        <<",", Rest1/binary>> -> array_val(skip_ws(Rest1), [Val | Acc]);
        <<"]", Rest1/binary>> -> {lists:reverse([Val | Acc]), Rest1};
        Other -> error({bad_array, Other})
    end.

object_val(<<"}", Rest/binary>>, Acc) -> {Acc, Rest};
object_val(Bin, Acc) ->
    {Key, Rest} = val(Bin),
    <<":", Rest1/binary>> = skip_ws(Rest),
    {Val, Rest2} = val(skip_ws(Rest1)),
    NewAcc = Acc#{Key => Val},
    case skip_ws(Rest2) of
        <<",", Rest3/binary>> -> object_val(skip_ws(Rest3), NewAcc);
        <<"}", Rest3/binary>> -> {NewAcc, Rest3};
        Other -> error({bad_object, Other})
    end.

number_val(Bin) ->
    case re:run(Bin, "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", [{capture, first}]) of
        {match, [{Start, Len}]} ->
            <<_:Start/binary, NumBin:Len/binary, Rest/binary>> = Bin,
            NumStr = binary_to_list(NumBin),
            Num = case lists:member($., NumStr) or lists:member($e, NumStr) or lists:member($E, NumStr) of
                true -> list_to_float(NumStr);
                false -> list_to_integer(NumStr)
            end,
            {ok, Num, Rest};
        nomatch ->
            error
    end.

encode(true) -> <<"true">>;
encode(false) -> <<"false">>;
encode(null) -> <<"null">>;
encode(Bin) when is_binary(Bin) ->
    << "\"", (escape(Bin))/binary, "\"" >>;
encode(Atom) when is_atom(Atom) ->
    encode(atom_to_binary(Atom, utf8));
encode(Num) when is_integer(Num) ->
    integer_to_binary(Num);
encode(Num) when is_float(Num) ->
    float_to_binary(Num, [{decimals, 4}, compact]);
encode(List) when is_list(List) ->
    Encoded = [encode(X) || X <- List],
    Joined = join(Encoded, <<",">>),
    << "[", Joined/binary, "]" >>;
encode(Map) when is_map(Map) ->
    Pairs = [ << (encode(K))/binary, ":", (encode(V))/binary >> || {K, V} <- maps:to_list(Map) ],
    Joined = join(Pairs, <<",">>),
    << "{", Joined/binary, "}" >>.

escape(Bin) ->
    escape(Bin, <<>>).
escape(<<>>, Acc) -> Acc;
escape(<<"\"", Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\\"">>);
escape(<<"\\", Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\\\">>);
escape(<<"\n", Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\n">>);
escape(<<"\r", Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\r">>);
escape(<<"\t", Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, "\\t">>);
escape(<<C, Rest/binary>>, Acc) -> escape(Rest, <<Acc/binary, C>>).

join([], _Sep) -> <<>>;
join([H | T], Sep) ->
    lists:foldl(fun(X, Acc) -> <<Acc/binary, Sep/binary, X/binary>> end, H, T).
