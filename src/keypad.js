/**
 * @see https://git.weboob.org/weboob/weboob/blob/master/weboob/tools/captcha/virtkeyboard.py
 */

const { errors, log } = require('cozy-konnector-libs')
const PNG = require('pngjs').PNG

/**
 * Digit limits within the PNG image of the virtual keypad.
 *
 * @note These limits never vary, even when some background pixels are randomly modified.
 *
 * @note The index of the array indicates the digit.
 * @note Each digit is defined by an array indicating the [firstColumn, firstLine, lastColumn, lastLine]
 *       pixels of the digit representation in the PNG image.
 */
const DIGIT_LIMITS = [
  [17, 7, 24, 17],
  [18, 6, 21, 18],
  [9, 7, 32, 34],
  [10, 7, 31, 34],
  [11, 6, 29, 34],
  [14, 6, 28, 34],
  [7, 7, 34, 34],
  [5, 6, 36, 34],
  [8, 7, 32, 34],
  [4, 7, 38, 34]
]

/**
 * Get the image limits, i.e. the pixel limits of the object represented on a background color.
 * @param {object} PNG image built with pngjs
 * @param {object} RGB representation of the background color
 * @returns {object} Image limits
 */
function getImageLimits(image, color) {
  // Initialization
  let limits = {}
  limits.firstLine = image.height
  limits.lastLine = 0
  limits.firstCol = image.width
  limits.lastCol = 0

  // Get the first and the last lines
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const idx = (image.width * y + x) << 2
      if (
        image.data[idx] == color.R &&
        image.data[idx + 1] == color.G &&
        image.data[idx + 2] == color.B
      ) {
        if (limits.firstLine == image.height) {
          limits.firstLine = y
        }
        limits.lastLine = y
        break
      }
    }
  }

  // Get the first and the last columns
  for (let x = 0; x < image.width; x++) {
    for (let y = 0; y < image.height; y++) {
      const idx = (image.height * y + x) << 2
      if (
        image.data[idx] == color.R &&
        image.data[idx + 1] == color.G &&
        image.data[idx + 2] == color.B
      ) {
        if (limits.firstCol == image.width) {
          limits.firstCol = x
        }
        limits.lastCol = x
      }
    }
  }

  return limits
}

/**
 * Check if known digit limits match image limits
 * @param {object} Known digit limits
 * @returns {bool} Limits match
 */
function checkLimits(digitLimits) {
  return (
    digitLimits[0] == this.firstCol &&
    digitLimits[1] == this.firstLine &&
    digitLimits[2] == this.lastCol &&
    digitLimits[3] == this.lastLine
  )
}

/**
 * Retrieve digit from image limits
 * @param {object} Image limits
 * @returns {Number} Digit
 */
function getDigit(limits) {
  const digit = DIGIT_LIMITS.findIndex(checkLimits, limits)

  // Check if the digit was correctly found
  if (digit == -1) {
    log(
      'error',
      'Failed to find a digit with limits: ' + JSON.stringify(limits)
    )
    throw new Error(errors.CAPTCHA_RESOLUTION_FAILED)
  }

  return digit
}

function getPassword($, password) {
  // Password input
  const $pwdInput = $('ul.password-input')

  // Extract the key <=> digit association from the virtual keypad
  const buttonToKeypad = button => {
    const $button = $(button)

    // Get the style attribute
    const btnStyle = $button.attr('style')

    // Parse style attribute for b64 picture
    const b64pic = btnStyle.match(/data:image\/([a-zA-Z]*);base64,([^)]*)/)[2]

    // Create a PNG image from the b64 picture
    const pngImg = PNG.sync.read(Buffer.from(b64pic, 'base64'))

    // Extract the limits of the digits within the PNG image
    const limits = getImageLimits(pngImg, { R: 255, G: 255, B: 255 })

    // Find the digit from the limits and associate it to its key
    const keypad = {
      key: $button.attr('data-matrix-key'),
      digit: getDigit(limits)
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
