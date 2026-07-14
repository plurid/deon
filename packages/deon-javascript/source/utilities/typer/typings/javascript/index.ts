// #region module
/**
 * Typing is outside the Deon data model, where everything is a string. The conversion is therefore
 * deliberately conservative: a value is only given a type when there is exactly one type it could
 * have meant, and the string it was written as can be recovered from it (specification 14).
 */


/**
 * No leading zeroes, so that `007` stays the string it was written as.
 */
const integer = /^-?(0|[1-9][0-9]*)$/;

const decimal = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;


const javascript = (
    value: string,
) => {
    if (value === 'true') {
        return true;
    }

    if (value === 'false') {
        return false;
    }

    if (integer.test(value)) {
        const number = Number(value);

        // Beyond the safe range the number no longer stands for the digits that were written, so
        // the digits are kept instead.
        return Number.isSafeInteger(number) ? number : value;
    }

    // A decimal is only a decimal when it is written as one: the integer forms are taken above.
    if (decimal.test(value) && (value.includes('.') || /[eE]/.test(value))) {
        const number = Number(value);

        return Number.isFinite(number) ? number : value;
    }

    return value;
}
// #endregion module



// #region exports
export default javascript;
// #endregion exports
