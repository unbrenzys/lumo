(function() {

    'use strict';

    const esper = require('esper');
    const Event = require('../../core/Event');
    const WebGLRenderer = require('./WebGLRenderer');
    const VertexAtlas = require('./VertexAtlas');

    const tileShader = {
        vert:
            `
            precision highp float;
            attribute vec2 aPosition;
            attribute float aRadius;
            uniform vec2 uTileOffset;
            uniform float uTileScale;
            uniform float uPixelRatio;
            uniform mat4 uProjectionMatrix;
            void main() {
                vec2 wPosition = (aPosition * uTileScale) + uTileOffset;
                gl_PointSize = aRadius * 2.0 * uPixelRatio;
                gl_Position = uProjectionMatrix * vec4(wPosition, 0.0, 1.0);
            }
            `,
        frag:
            `
            #ifdef GL_OES_standard_derivatives
                #extension GL_OES_standard_derivatives : enable
            #endif
            precision highp float;
            uniform vec4 uColor;
            void main() {
                vec2 cxy = 2.0 * gl_PointCoord - 1.0;
                float r = dot(cxy, cxy);
                #ifdef GL_OES_standard_derivatives
                    float delta = fwidth(r);
                    float alpha = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, r);
                #endif
                gl_FragColor = vec4(uColor.rgb, uColor.a * alpha);
            }
            `
    };

    const layerShader = {
        vert:
            `
            precision highp float;
            attribute vec3 aVertexPosition;
            attribute vec2 aTextureCoord;
            varying vec2 vTextureCoord;
            void main(void) {
                vTextureCoord = aTextureCoord;
                gl_Position = vec4(aVertexPosition, 1.0);
            }
            `,
        frag:
            `
            precision highp float;
            uniform float uOpacity;
            uniform sampler2D uTextureSampler;
            varying vec2 vTextureCoord;
            void main(void) {
                vec4 color = texture2D(uTextureSampler, vTextureCoord);
                gl_FragColor = vec4(color.rgb, color.a * uOpacity);
            }
            `
    };

    const createQuad = function(min, max) {
        const vertices = new Float32Array(24);
        // positions
        vertices[0] = min;      vertices[1] = min;
        vertices[2] = max;      vertices[3] = min;
        vertices[4] = max;      vertices[5] = max;
        vertices[6] = min;      vertices[7] = min;
        vertices[8] = max;      vertices[9] = max;
        vertices[10] = min;     vertices[11] = max;
        // uvs
        vertices[12] = 0;       vertices[13] = 0;
        vertices[14] = 1;       vertices[15] = 0;
        vertices[16] = 1;       vertices[17] = 1;
        vertices[18] = 0;       vertices[19] = 0;
        vertices[20] = 1;       vertices[21] = 1;
        vertices[22] = 0;       vertices[23] = 1;
        // create quad buffer
        return new esper.VertexBuffer(
            vertices,
            {
                0: {
                    size: 2,
                    type: 'FLOAT',
                    byteOffset: 0
                },
                1: {
                    size: 2,
                    type: 'FLOAT',
                    byteOffset: 2 * 6 * 4
                }
            },
            {
                count: 6,
            });
    };

    const getRenderables = function(plot, pyramid) {

        // get all currently visible tile coords
        const coords = plot.viewport.getVisibleCoords(
            plot.tileSize,
            plot.zoom,
            Math.round(plot.zoom), // get tiles closest to current zoom
            plot.wraparound);

        // get available renderables
        const renderables = [];
        coords.forEach(coord => {
            const ncoord = coord.normalize();
            // check if we have the tile
            if (pyramid.has(ncoord)) {
                const renderable = {
                    coord: coord,
                    scale: Math.pow(2, plot.zoom - coord.z),
                    hash: ncoord.hash
                };
                renderables.push(renderable);
            }
        });
        return renderables;
    };

    const renderTiles = function(gl, atlas, shader, plot, pyramid, color) {
        // get projection
        const proj = plot.viewport.getOrthoMatrix();

        // get view offset
        const viewOffset = [
            plot.viewport.x,
            plot.viewport.y
        ];

        // get renderables
        const renderables = getRenderables(plot, pyramid);

        // bind render target
        plot.renderBuffer.bind();

        // clear render target
        gl.clear(gl.COLOR_BUFFER_BIT);

        // set blending func
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        // bind shader
        shader.use();

        // set projection
        shader.setUniform('uProjectionMatrix', proj);

        // binds the buffer to instance
        atlas.bind();

        // set color
        shader.setUniform('uColor', color);
        // set pixel ratio
        shader.setUniform('uPixelRatio', window.devicePixelRatio);

        // for each renderable
        renderables.forEach(renderable => {
            const coord = renderable.coord;
            // set tile scale
            shader.setUniform('uTileScale', renderable.scale);
            // get tile offset
            const tileOffset = [
                coord.x * renderable.scale * plot.tileSize,
                coord.y * renderable.scale * plot.tileSize
            ];
            const offset = [
                tileOffset[0] - viewOffset[0],
                tileOffset[1] - viewOffset[1]
            ];
            shader.setUniform('uTileOffset', offset);
            // draw the instances
            atlas.draw(renderable.hash, 'POINTS');
        });

        // unbind
        atlas.unbind();

        // unbind render target
        plot.renderBuffer.unbind();
    };

    const renderlayer = function(gl, plot, opacity, shader, quad) {

        // bind shader
        shader.use();

        // set blending func
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // set uniforms
        shader.setUniform('uOpacity', opacity);
        // set texture sampler unit
        shader.setUniform('uTextureSampler', 0);

        // bind texture
        plot.renderTexture.bind(0);

        // draw quad
        quad.bind();
        quad.draw();
        quad.unbind();

        // unbind texture
        plot.renderTexture.unbind();
    };

    /**
     * Class representing a pointer renderer.
     */
    class PointRenderer extends WebGLRenderer {

        /**
         * Instantiates a new PointRenderer object.
         */
        constructor() {
            super();
            this.quad = null;
            this.shaders = null;
            this.atlas = null;
        }

        /**
         * Executed when the renderer is attached to a layer.
         *
         * @param {Layer} layer - The layer to attach the renderer to.
         *
         * @returns {Renderer} The renderer object, for chaining.
         */
        onAdd(layer) {
            super.onAdd(layer);
            this.quad = createQuad(-1, 1);
            this.shaders = new Map([
                ['tile', new esper.Shader(tileShader)],
                ['layer', new esper.Shader(layerShader)]
            ]);
            this.atlas = new VertexAtlas({
                // position
                0: {
                    size: 2,
                    type: 'FLOAT'
                },
                // radius
                1: {
                    size: 1,
                    type: 'FLOAT'
                }
            }, {
                // set num chunks to be able to fit the capacity of the pyramid
                numChunks: layer.pyramid.totalCapacity
            });
            this.tileAdd = tile => {
                this.atlas.set(tile.coord.hash, tile.data, tile.data.length / 3);
            };
            this.tileRemove = tile => {
                this.atlas.delete(tile.coord.hash);
            };
            layer.on(Event.TILE_ADD, this.tileAdd);
            layer.on(Event.TILE_REMOVE, this.tileRemove);
            return this;
        }

        /**
         * Executed when the renderer is removed from a layer.
         *
         * @param {Layer} layer - The layer to remove the renderer from.
         *
         * @returns {Renderer} The renderer object, for chaining.
         */
        onRemove(layer) {
            this.layer.removeListener(this.add);
            this.layer.removeListener(this.remove);
            this.tileAdd = null;
            this.tileRemove = null;
            this.shaders = null;
            this.atlas = null;
            super.onRemove(layer);
            return this;
        }

        /**
         * The draw function that is executed per frame.
         *
         * @param {Number} timestamp - The frame timestamp.
         *
         * @returns {Renderer} The renderer object, for chaining.
         */
        draw() {
            const gl = this.gl;
            // enable blending
            gl.enable(gl.BLEND);
            // render the tiles
            renderTiles(
                this.gl,
                this.atlas,
                this.shaders.get('tile'),
                this.layer.plot,
                this.layer.pyramid,
                [ 1.0, 0.4, 0.1, 0.8]);
            // render framebuffer to the backbuffer
            renderlayer(
                this.gl,
                this.layer.plot,
                this.layer.opacity,
                this.shaders.get('layer'),
                this.quad);
            return this;
        }
    }

    module.exports = PointRenderer;

}());
