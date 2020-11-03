/// Construct a `deon::Value` from a deon literal.
///
/// ```
/// # use deon::deon;
/// #
/// let value = deon!({
///     key value
/// });
/// ```
///
/// Variables or expressions can be interpolated into the deon literal. Any type
/// interpolated into an array element or object value must implement deon's
/// `Serialize` trait, while any type interpolated into a object key must
/// implement `Into<String>`. If the `Serialize` implementation of the
/// interpolated type decides to fail, or if the interpolated type contains a
/// map with non-string keys, the `deon!` macro will panic.
///
/// ```
/// # use deon::deon;
/// #
/// let code = 200;
/// let features = vec!["key", "value"];
///
/// let value = deon!({
///     code code
///     success code == 200
///     payload {
///         features[0] features[1]
///     }
/// });
/// ```
#[macro_export(local_inner_macros)]
macro_rules! deon {
    // Hide distracting implementation details from the generated rustdoc.
    ($($deon:tt)+) => {
        deon_internal!($($deon)+)
    };
}


#[macro_export(local_inner_macros)]
#[doc(hidden)]
macro_rules! deon_internal {
    // //////////////////////////////////////////////////////////////////////////
    // // TT muncher for parsing the inside of an array [...]. Produces a vec![...]
    // // of the elements.
    // //
    // // Must be invoked as: deon_internal!(@array [] $($tt)*)
    // //////////////////////////////////////////////////////////////////////////

    // // Done with trailing comma.
    // (@array [$($elems:expr,)*]) => {
    //     deon_internal_vec![$($elems,)*]
    // };

    // // Done without trailing comma.
    // (@array [$($elems:expr),*]) => {
    //     deon_internal_vec![$($elems),*]
    // };

    // // Next element is `null`.
    // (@array [$($elems:expr,)*] null $($rest:tt)*) => {
    //     deon_internal!(@array [$($elems,)* deon_internal!(null)] $($rest)*)
    // };

    // // Next element is `true`.
    // (@array [$($elems:expr,)*] true $($rest:tt)*) => {
    //     deon_internal!(@array [$($elems,)* deon_internal!(true)] $($rest)*)
    // };

    // // Next element is `false`.
    // (@array [$($elems:expr,)*] false $($rest:tt)*) => {
    //     deon_internal!(@array [$($elems,)* deon_internal!(false)] $($rest)*)
    // };

    // // Next element is an array.
    // (@array [$($elems:expr,)*] [$($array:tt)*] $($rest:tt)*) => {
    //     deon_internal!(@array [$($elems,)* deon_internal!([$($array)*])] $($rest)*)
    // };

    // // Next element is a map.
    // (@array [$($elems:expr,)*] {$($map:tt)*} $($rest:tt)*) => {
    //     deon_internal!(@array [$($elems,)* deon_internal!({$($map)*})] $($rest)*)
    // };

    // // Next element is an expression followed by comma.
    // (@array [$($elems:expr,)*] $next:expr, $($rest:tt)*) => {
    //     deon_internal!(@array [$($elems,)* deon_internal!($next),] $($rest)*)
    // };

    // // Last element is an expression with no trailing comma.
    // (@array [$($elems:expr,)*] $last:expr) => {
    //     deon_internal!(@array [$($elems,)* deon_internal!($last)])
    // };

    // // Comma after the most recent element.
    // (@array [$($elems:expr),*] , $($rest:tt)*) => {
    //     deon_internal!(@array [$($elems,)*] $($rest)*)
    // };

    // // Unexpected token after most recent element.
    // (@array [$($elems:expr),*] $unexpected:tt $($rest:tt)*) => {
    //     deon_unexpected!($unexpected)
    // };

    // //////////////////////////////////////////////////////////////////////////
    // // TT muncher for parsing the inside of an object {...}. Each entry is
    // // inserted into the given map variable.
    // //
    // // Must be invoked as: deon_internal!(@object $map () ($($tt)*) ($($tt)*))
    // //
    // // We require two copies of the input tokens so that we can match on one
    // // copy and trigger errors on the other copy.
    // //////////////////////////////////////////////////////////////////////////

    // // Done.
    // (@object $object:ident () () ()) => {};

    // // Insert the current entry followed by trailing comma.
    // (@object $object:ident [$($key:tt)+] ($value:expr) , $($rest:tt)*) => {
    //     let _ = $object.insert(($($key)+).into(), $value);
    //     deon_internal!(@object $object () ($($rest)*) ($($rest)*));
    // };

    // // Current entry followed by unexpected token.
    // (@object $object:ident [$($key:tt)+] ($value:expr) $unexpected:tt $($rest:tt)*) => {
    //     deon_unexpected!($unexpected);
    // };

    // // Insert the last entry without trailing comma.
    // (@object $object:ident [$($key:tt)+] ($value:expr)) => {
    //     let _ = $object.insert(($($key)+).into(), $value);
    // };

    // // Next value is `null`.
    // (@object $object:ident ($($key:tt)+) (: null $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object [$($key)+] (deon_internal!(null)) $($rest)*);
    // };

    // // Next value is `true`.
    // (@object $object:ident ($($key:tt)+) (: true $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object [$($key)+] (deon_internal!(true)) $($rest)*);
    // };

    // // Next value is `false`.
    // (@object $object:ident ($($key:tt)+) (: false $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object [$($key)+] (deon_internal!(false)) $($rest)*);
    // };

    // // Next value is an array.
    // (@object $object:ident ($($key:tt)+) (: [$($array:tt)*] $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object [$($key)+] (deon_internal!([$($array)*])) $($rest)*);
    // };

    // // Next value is a map.
    // (@object $object:ident ($($key:tt)+) (: {$($map:tt)*} $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object [$($key)+] (deon_internal!({$($map)*})) $($rest)*);
    // };

    // // Next value is an expression followed by comma.
    // (@object $object:ident ($($key:tt)+) (: $value:expr , $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object [$($key)+] (deon_internal!($value)) , $($rest)*);
    // };

    // // Last value is an expression with no trailing comma.
    // (@object $object:ident ($($key:tt)+) (: $value:expr) $copy:tt) => {
    //     deon_internal!(@object $object [$($key)+] (deon_internal!($value)));
    // };

    // // Missing value for last entry. Trigger a reasonable error message.
    // (@object $object:ident ($($key:tt)+) (:) $copy:tt) => {
    //     // "unexpected end of macro invocation"
    //     deon_internal!();
    // };

    // // Missing colon and value for last entry. Trigger a reasonable error
    // // message.
    // (@object $object:ident ($($key:tt)+) () $copy:tt) => {
    //     // "unexpected end of macro invocation"
    //     deon_internal!();
    // };

    // // Misplaced colon. Trigger a reasonable error message.
    // (@object $object:ident () (: $($rest:tt)*) ($colon:tt $($copy:tt)*)) => {
    //     // Takes no arguments so "no rules expected the token `:`".
    //     deon_unexpected!($colon);
    // };

    // // Found a comma inside a key. Trigger a reasonable error message.
    // (@object $object:ident ($($key:tt)*) (, $($rest:tt)*) ($comma:tt $($copy:tt)*)) => {
    //     // Takes no arguments so "no rules expected the token `,`".
    //     deon_unexpected!($comma);
    // };

    // // Key is fully parenthesized. This avoids clippy double_parens false
    // // positives because the parenthesization may be necessary here.
    // (@object $object:ident () (($key:expr) : $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object ($key) (: $($rest)*) (: $($rest)*));
    // };

    // // Refuse to absorb colon token into key expression.
    // (@object $object:ident ($($key:tt)*) (: $($unexpected:tt)+) $copy:tt) => {
    //     deon_expect_expr_comma!($($unexpected)+);
    // };

    // // Munch a token into the current key.
    // (@object $object:ident ($($key:tt)*) ($tt:tt $($rest:tt)*) $copy:tt) => {
    //     deon_internal!(@object $object ($($key)* $tt) ($($rest)*) ($($rest)*));
    // };

    // //////////////////////////////////////////////////////////////////////////
    // // The main implementation.
    // //
    // // Must be invoked as: deon_internal!($($deon)+)
    // //////////////////////////////////////////////////////////////////////////

    (null) => {
        $crate::Value::Null
    };

    (true) => {
        $crate::Value::Bool(true)
    };

    (false) => {
        $crate::Value::Bool(false)
    };

    ([]) => {
        $crate::Value::Array(deon_internal_vec![])
    };

    ([ $($tt:tt)+ ]) => {
        $crate::Value::Array(deon_internal!(@array [] $($tt)+))
    };

    ({}) => {
        $crate::Value::Object($crate::Map::new())
    };

    ({ $($tt:tt)+ }) => {
        $crate::Value::Object({
            let mut object = $crate::Map::new();
            deon_internal!(@object object () ($($tt)+) ($($tt)+));
            object
        })
    };

    // Any Serialize type: numbers, strings, struct literals, variables etc.
    // Must be below every other rule.
    ($other:expr) => {
        $crate::to_value(&$other).unwrap()
    };
}


// The deon_internal macro above cannot invoke vec directly because it uses
// local_inner_macros. A vec invocation there would resolve to $crate::vec.
// Instead invoke vec here outside of local_inner_macros.
#[macro_export]
#[doc(hidden)]
macro_rules! deon_internal_vec {
    ($($content:tt)*) => {
        vec![$($content)*]
    };
}


#[macro_export]
#[doc(hidden)]
macro_rules! deon_unexpected {
    () => {};
}


#[macro_export]
#[doc(hidden)]
macro_rules! deon_expect_expr_comma {
    ($e:expr , $($tt:tt)*) => {};
}
