/// Deon Tests
/// run with
/// > cargo test -- --nocapture


use deon::Deon;



#[test]
fn simple() {
    let _deon = Deon {};

    let data = "
{
    key value
}
";
    println!("{}", data);
    // deon.parse(data);

    assert_eq!(1, 1);
}
