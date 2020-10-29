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
    println!("{}", data);
    deon.parse(data);

    assert_eq!(1, 1);
}
