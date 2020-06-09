function getPassword($, password) {
  // Password input
  const $pwdInput = $('ul.password-input')

  // Extract the key <=> digit association from the virtual keypad
  const buttonToKeypad = button => {
    const $button = $(button)




    const keypad = {
      key: $button.attr('data-matrix-key'),
      digit: 0
    }

    return keypad
  }

  const virtualKeypad = $pwdInput
    .find('[data-matrix-key]')
    .map((x, y) => buttonToKeypad(y))
    .get()

  // Find the key corresponding to the password digit in the virtual keypad
  const digitToKey = digit => {
    return virtualKeypad.find(el => el.digit == digit).key
  }

  // Get DOM buttons that match digit images
  return [...password].map(digitToKey)
}

module.exports = {
  getPassword
}
