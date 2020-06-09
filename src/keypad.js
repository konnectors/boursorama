function getPassword($, password) {
  // Password input
  const $pwdInput = $('ul.password-input')

  // Extract the key <=> digit association from the virtual keypad
  const buttonToKeypad = button => {
    const $button = $(button)

    // Get the img tag source
    const btnImageSrc = $button.find('img').attr('src')

    // Parse image tag for b64 picture
    const b64pic = btnImageSrc.match(
      /data:image\/([a-zA-Z+]*);base64,([^)]*)/
    )[2]

    // Convert base64 encoded image to SVG text description
    const svgImg = Buffer.from(b64pic, 'base64').toString('utf-8')

    // Extract digit from SVG text description
    const keypad = {
      key: $button.attr('data-matrix-key'),
      digit: svgImg.match(/ id="(\d)"/)[1]
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
