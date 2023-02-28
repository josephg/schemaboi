import { Schema, SimpleSchema } from "./schema.js"
import { enumOfStrings, enumOfStringsSimple, extendSchema, ref } from "./utils.js"
import fs from 'fs'
import { toBinary } from "./write.js"

const tldrawTest = () => {
  const testSchema: SimpleSchema = {
    id: 'Shape',
    // root: ref('Shape'),
    root: {type: 'list', fieldType: ref('Shape')},
    types: {
      Shape: {
        type: 'struct',
        // encodingOrder: ['id', 'x', 'y', 'rotation', 'parentId', 'index', 'props'], // 'typeName',
        fields: {
          x: {type: 'f32', optional: false},
          y: {type: 'f32', optional: false},
          rotation: {type: 'f32', optional: false},
          id: {type: 'id', optional: false},
          parentId: {type: 'id', optional: false},
          index: {type: 'string', optional: false},
          typeName: {type: ref('ShapeType'), optional: false},
          props: {type: ref('Props'), optional: false},
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
        closed: false,
        typeFieldOnParent: 'type',
        variants: {
          text: { associatedData: {
            type: 'struct',
            // encodingOrder: ['opacity', 'color', 'size', 'w', 'text', 'font', 'align', 'autoSize'],
            fields: {
              opacity: {type: 'string', optional: false},
              color: {type: ref('Color'), optional: false},
              size: {type: ref('Size'), optional: false},
              w: {type: 'uint', optional: false},
              text: {type: 'string', optional: false},
              font: {type: 'string', optional: false},
              align: {type: ref('Alignment'), optional: false},
              autoSize: {type: 'bool', optional: false},
            }
          }},

          geo: { associatedData: {
            type: 'struct',
            // encodeOptional: 'none',
            // encodingOrder: ['w', 'h', 'geo', 'color']
            fields: {
              w: {type: 'f32', optional: false},
              h: {type: 'f32', optional: false},
              geo: {type: ref('GeoType'), optional: false},
              color: {type: ref('Color'), optional: false},
              fill: {type: ref('Fill'), optional: false},
              dash: {type: ref('Dash'), optional: false},
              size: {type: ref('Size'), optional: false},
              opacity: {type: 'string'}, // Why is this a string?
              font: {type: 'string'}, // Or enumOfStrings(['draw'])
              text: {type: 'string', optional: false},
              align: {type: ref('Alignment'), optional: false},
              growY: {type: 'uint', optional: false},
            }
          }},

          arrow: { associatedData: {
            type: 'struct',
            // encodeOptional: 'none',
            fields: {
              opacity: {type: 'string', optional: false}, // Why is this a string?
              dash: {type: ref('Dash'), optional: false},
              size: {type: ref('Size'), optional: false},
              fill: {type: ref('Fill'), optional: false},
              color: {type: ref('Color'), optional: false},
              w: {type: 'f32', optional: false},
              h: {type: 'f32', optional: false},
              bend: {type: 'f32', optional: false},

              start: {type: ref('ArrowEnd'), optional: false},
              end: {type: ref('ArrowEnd'), optional: false},

              arrowheadStart: {type: ref('ArrowHead'), optional: false},
              arrowheadEnd: {type: ref('ArrowHead'), optional: false},
            }
          }}
        }
      },

      Vec2: {
        type: 'struct',
        fields: {
          x: {type: 'f32', optional: false},
          y: {type: 'f32', optional: false}
        }
      },

      ArrowEnd: {
        type: 'struct',
        fields: {
          x: {type: 'f32', optional: false},
          y: {type: 'f32', optional: false},
          binding: {type: 'id', optional: false},
          anchor: {type: ref('Vec2'), optional: false}
        }
      }
    }
  }

  console.log('\n\n')
  const shapes = JSON.parse(fs.readFileSync('./tldraw-example.json', 'utf8')).data.shape
  // console.log(shapes)
  let out = toBinary(extendSchema(testSchema), shapes)
  // const out = readData(testSchema, shapes)
  console.log('Output length', out.length)
  fs.writeFileSync('tld2.scb', out)

}

tldrawTest()