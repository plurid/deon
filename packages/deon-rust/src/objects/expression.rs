use super::token::{Token};



pub struct Expression {

}

// impl Expression {
//     fn accept(
//         visitor: Visitor,
//     ) {

//     }
// }


pub struct Visitor {

}

// impl Visitor {
//     pub fn visitAssignExpression (
//         &self,
//         assignExpression: AssignExpression,
//     ) {

//     }
// }


pub struct AssignExpression {
    name: Token,
    value: Expression,
}

impl AssignExpression {
    pub fn new(
        name: Token,
        value: Expression,
    ) -> AssignExpression {
        AssignExpression {
            name,
            value,
        }
    }

    pub fn accept(
        &self,
        visitor: Visitor,
    ) -> Visitor {
        visitor
    }
}
