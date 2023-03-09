import { Schema, AppSchema } from "../lib/schema.js"
import { enumOfStringsSimple, extendSchema, ref, fillSchemaDefaults } from "../lib/utils.js"
import fs from 'fs'
import { writeRaw, write } from "../lib/write.js"
import { metaSchema } from "../lib/metaschema.js"
import { readRaw } from "../lib/read.js"
import * as assert from 'assert/strict'

import {Console} from 'node:console'
const console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  inspectOptions: {depth: null}
})

const tldrawTest = () => {
  const testSchema: AppSchema = {
    id: 'Shape',
    // root: ref('Shape'),
    root: {type: 'list', fieldType: 'Shape'},
    types: {
      Shape: {
        type: 'struct',
        fields: {
          x: 'f32',
          y: 'f32',
          rotation: 'f32',
          id: 'id',
          parentId: 'id',
          index: 'string',
          typeName: 'ShapeType',
          props: 'Props',
          // {key: 'type', valType: enumOfStrings(['geo', 'arrow', 'text'])},
        }
      },

      ShapeType: enumOfStringsSimple('shape'),
      Color: enumOfStringsSimple('light-blue', 'light-red', 'black', 'light-green', 'yellow', 'light-violet'),
      Size: enumOfStringsSimple('l', 'xl'),
      Alignment: enumOfStringsSimple('middle', 'start', 'end'),
      GeoType: enumOfStringsSimple('ellipse', 'rectangle'),
      Fill: enumOfStringsSimple('pattern', 'none'),
      Dash: enumOfStringsSimple('draw'),
      ArrowHead: enumOfStringsSimple('arrow', 'none'),

      Props: {
        type: 'enum',
        numericOnly: false,
        exhaustive: false,
        typeFieldOnParent: 'type',
        variants: {
          text: {
            fields: {
              opacity: 'string',
              color: 'Color',
              size: 'Size',
              w: 'u32',
              text: 'string',
              font: 'string',
              align: 'Alignment',
              autoSize: 'bool',
            }
          },

          geo: {
            fields: {
              w: 'f32',
              h: 'f32',
              geo: ref('GeoType'),
              color: ref('Color'),
              fill: ref('Fill'),
              dash: ref('Dash'),
              size: ref('Size'),
              opacity: 'string', // Why is this a string?
              font: 'string', // Or enumOfStrings(['draw'])
              text: 'string',
              align: ref('Alignment'),
              growY: 'u32',
            }
          },

          arrow: {
            fields: {
              opacity: 'string', // Why is this a string?
              dash: ref('Dash'),
              size: ref('Size'),
              fill: ref('Fill'),
              color: ref('Color'),
              w: 'f32',
              h: 'f32',
              bend: 'f32',

              start: ref('ArrowEnd'),
              end: ref('ArrowEnd'),

              arrowheadStart: ref('ArrowHead'),
              arrowheadEnd: ref('ArrowHead'),
            }
          }
        }
      },

      Vec2: {
        type: 'struct',
        fields: {
          x: 'f32',
          y: 'f32',
        }
      },

      ArrowEnd: {
        type: 'struct',
        fields: {
          x: 'f32',
          y: 'f32',
          binding: 'id',
          anchor: 'Vec2',
        }
      }
    }
  }

  // console.log('\n\n')
  const shapes = JSON.parse(fs.readFileSync('./tldraw-example.json', 'utf8')).data.shape
  // console.log(shapes)
  const fullSchema = extendSchema(testSchema)
  fillSchemaDefaults(fullSchema, true)

  const sOut = writeRaw(metaSchema, fullSchema)
  console.log('Schema size', sOut.length)
  const mm = readRaw(metaSchema, sOut)
  fillSchemaDefaults(mm, true)
  // console.log(mm)
  // console.log(fullSchema)
  // assert.deepEqual(fullSchema, mm)


  console.log('schema', sOut)
  fs.writeFileSync('tld_schema.scb', sOut)


  let out = write(fullSchema, shapes)

  // let out = toBinary(fullSchema, shapes)
  // // const out = readData(testSchema, shapes)
  console.log('Output length', out.length)
  fs.writeFileSync('tld2.scb', out)

}

// tldrawTest()