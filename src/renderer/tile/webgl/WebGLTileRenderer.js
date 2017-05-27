'use strict';

const Shader = require('../../../webgl/shader/Shader');
const TileRenderer = require('../TileRenderer');

/**
 * Class representing a webgl tile renderer.
 */
class WebGLTileRenderer extends TileRenderer {

	/**
	 * Instantiates a new WebGLTileRenderer object.
	 */
	constructor() {
		super();
		this.gl = null;
	}

	/**
	 * Executed when the layer is attached to a plot.
	 *
	 * @param {Layer} layer - The layer to attach the renderer to.
	 *
	 * @returns {WebGLTileRenderer} The renderer object, for chaining.
	 */
	onAdd(layer) {
		super.onAdd(layer);
		this.gl = this.layer.plot.getRenderingContext();
		return this;
	}

	/**
	 * Executed when the layer is removed from a plot.
	 *
	 * @param {Layer} layer - The layer to remove the renderer from.
	 *
	 * @returns {WebGLRenderer} The renderer object, for chaining.
	 */
	onRemove(layer) {
		this.gl = null;
		super.onRemove(layer);
		return this;
	}

	/**
	 * Instantiate and return a new Shader object using the renderers internal
	 * WebGLRenderingContext.
	 *
	 * @param {Object} source - The shader param object.
	 * @param {string} source.common - Common glsl to be shared by both vertex and fragment shaders.
	 * @param {string} source.vert - The vertex shader glsl.
	 * @param {string} source.frag - The fragment shader glsl.
	 *
	 * @returns {Shader} The shader object.
	 */
	createShader(source) {
		return new Shader(this.gl, source);
	}

	/**
	 * Returns the orthographic projection matrix for the viewport.
	 *
	 * @returns {Float32Array} The orthographic projection matrix.
	 */
	getOrthoMatrix() {
		return this.layer.plot.getOrthoMatrix();
	}
}

module.exports = WebGLTileRenderer;
