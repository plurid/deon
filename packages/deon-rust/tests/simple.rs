/// Deon Tests
/// run with
/// > cargo test -- --nocapture


use deon::Deon;



#[test]
fn simple() {
    let deon = Deon {};

    let data = String::from("
{
    key value
}
");

    let result = deon.parse(data);

    assert_eq!(result.is_empty(), true);
}
