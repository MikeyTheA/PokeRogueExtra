// this library is a mess, some parts are AI generated

import * as data from './configuration'

class OverlayWindow {
    constructor(name, open = true, options = {}) {
        this.name = name;
        this.options = {
            draggable: options.draggable ?? true,
            resizable: options.resizable ?? true,
            width: data.get(`windows/${this.name}/width`) || (options.width ?? '300px'),
            height: data.get(`windows/${this.name}/height`) || (options.height ?? '200px'),
            minWidth: options.minWidth ?? 200,
            minHeight: options.minHeight ?? 200,
            x: data.get(`windows/${this.name}/x`) || (options.x ?? '10px'),
            y: data.get(`windows/${this.name}/y`) || (options.y ?? '10px'),
            ...options
        };
        this.createWindowElement();
        this.visible = data.get(`windows/${this.name}/visible`) || open;
        data.save()
    }

    createWindowElement() {
        this.element = document.createElement('div');
        this.element.style.width = this.options.width;
        this.element.style.height = this.options.height;
        this.element.style.position = 'fixed';
        this.element.style.zIndex = '1000';
        this.element.className = 'overlay-window';

        this.element.style.top = this.options.y;
        this.element.style.left = this.options.x;

        const titleBar = document.createElement('div');
        titleBar.textContent = this.name;
        titleBar.className = 'overlay-window-titlebar';

        if (this.options.draggable) {
            this.makeDraggable(titleBar);
        }
        if (this.options.resizable) {
            this.makeResizable();
        }

        this.contentArea = document.createElement('div');
        this.contentArea.className = 'overlay-window-content';

        this.element.appendChild(titleBar);
        this.element.appendChild(this.contentArea);
        document.body.appendChild(this.element);
    }

    get visible() {
        return this.element.style.display !== 'none';
    }

    set visible(value) {
        this.element.style.display = value ? 'block' : 'none';
    }

    makeDraggable(element) {
        let posX = 0, posY = 0, posInitial = 0, posFinal = 0;
        element.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            e = e;
            e.preventDefault();
            posInitial = e.clientX;
            posFinal = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }

        const elementDrag = (e) => {
            e = e;
            e.preventDefault();
            posX = posInitial - e.clientX;
            posY = posFinal - e.clientY;
            posInitial = e.clientX;
            posFinal = e.clientY;
            element.parentNode.style.top = Math.min(window.innerHeight - parseInt(element.parentNode.style.height, 10), Math.max(0, element.parentNode.offsetTop - posY)) + "px";
            element.parentNode.style.left = Math.min(window.innerWidth - parseInt(element.parentNode.style.width, 10), Math.max(0, element.parentNode.offsetLeft - posX)) + "px";
            data.set(`windows/${this.name}/x`, (element.parentNode.offsetLeft - posX) + "px")
            data.set(`windows/${this.name}/y`, (element.parentNode.offsetTop - posY) + "px")
        }

        function closeDragElement() {
            document.onmouseup = null;
            document.onmousemove = null;
        }
    }

    makeResizable() {
        const initDrag = (e) => {
            e.preventDefault();
            startX = e.clientX;
            startY = e.clientY;
            startWidth = parseInt(window.getComputedStyle(this.element).width, 10);
            startHeight = parseInt(window.getComputedStyle(this.element).height, 10);
            document.documentElement.addEventListener('mousemove', doDrag, false);
            document.documentElement.addEventListener('mouseup', stopDrag, false);
        }
        
        const doDrag = (e) => {
            const newWidth = startWidth + e.clientX - startX;
            const newHeight = startHeight + e.clientY - startY;

            this.element.style.width = Math.max(newWidth, this.options.minWidth) + 'px';
            this.element.style.height = Math.max(newHeight, this.options.minHeight) + 'px';
            data.set(`windows/${this.name}/width`, Math.max(newWidth, this.options.minWidth) + 'px')
            data.set(`windows/${this.name}/height`, Math.max(newHeight, this.options.minHeight) + 'px')
        }
        
        const stopDrag = () => {
            document.documentElement.removeEventListener('mousemove', doDrag, false);
            document.documentElement.removeEventListener('mouseup', stopDrag, false);
        }

        const resizeHandle = document.createElement('div');
        resizeHandle.classList.add('resize-handle')
        this.element.appendChild(resizeHandle);

        let startX, startY, startWidth, startHeight;
        
        resizeHandle.addEventListener('mousedown', initDrag);
    }
}

class Label{
    constructor(window, text){
        this.element = document.createElement('p')
        this.element.classList.add('label')
        this.element.textContent = text
        window.contentArea.appendChild(this.element)
    }
}

class Button{
    constructor(window, text, onClick){
        this.element = document.createElement('button')
        this.element.classList.add('button')
        this.element.textContent = text
        this.onClick = onClick ?? (() => {console.log("This button has no function!")})
        window.contentArea.appendChild(this.element)
    }

    set onClick(value){
        this.element.removeEventListener('click', this._onClick)
        this._onClick = value
        this.element.addEventListener('click', this._onClick);
    }
}

class Checkbox{
    constructor(window, text, onChange){
        this.container = document.createElement('div');
        this.container.classList.add('checkbox-container');

        this.textElement = document.createElement('label')
        this.textElement.textContent = text

        this.element = document.createElement('input')
        this.element.type = "checkbox"
        this.element.classList.add('checkbox')

        this.container.appendChild(this.textElement)
        this.container.appendChild(this.element)

        this.onChange = onChange ?? (() => {console.log("This checkbox has no onChange!")})

        window.contentArea.appendChild(this.container)
    }

    set onChange(value){
        this.element.removeEventListener('change', (val) => {this._onChange(val.target.checked)})
        this._onChange = value
        this.element.addEventListener('change', (val) => {this._onChange(val.target.checked)});
    }
}

class Slider{
    constructor(window, text, onChange, options = {}){

        this.options = {
            min: options.min ?? 0,
            max: options.max ?? 100
        }

        this.container = document.createElement('div');
        this.container.classList.add('slider-container');

        this.textElement = document.createElement('label')
        this.textElement.textContent = text

        this.element = document.createElement('input')
        this.element.type = "range"
        this.element.classList.add('slider')

        this.container.appendChild(this.textElement)
        this.container.appendChild(this.element)

        this.onChange = onChange ?? (() => {console.log("This slider has no onChange!")})

        window.contentArea.appendChild(this.container)
    }

    set onChange(value){
        this.element.removeEventListener('change', (val) => {this._onChange(val.target.value)})
        this._onChange = value
        this.element.addEventListener('change', (val) => {this._onChange(val.target.value)});
    }

    get value(){
        return this.element.value
    }

    set value(val){
        this.element.value = val
    }
}

class Container {
    constructor(window, text, open){
        this.container = document.createElement('div');
        this.container.classList.add('collapsible-container');

        this.titleBar = document.createElement('div');
        this.titleBar.classList.add('collapsible-titlebar');
        this.titleBar.textContent = text;

        this.contentArea = document.createElement('div');
        this.contentArea.classList.add('collapsible-content');
        this.contentArea.style.display = open ? 'block' : 'none';

        this.container.appendChild(this.titleBar);
        this.container.appendChild(this.contentArea);

        window.contentArea.appendChild(this.container);
        this.titleBar.addEventListener('click', () => this.toggleContent());
    }

    toggleContent() {
        const isDisplayed = this.contentArea.style.display !== 'none';
        this.contentArea.style.display = isDisplayed ? 'none' : 'block';
    }

    delete() {
        this.container.remove()
    }
}

class TextBox {
    constructor(window, text, onChange){
        this.container = document.createElement('div');
        this.container.classList.add('textbox-container');

        this.textElement = document.createElement('label')
        this.textElement.textContent = text

        this.element = document.createElement('input')
        this.element.classList.add('textbox')

        this.container.appendChild(this.textElement)
        this.container.appendChild(this.element)

        this.onChange = onChange ?? (() => {console.log("This TextBox has no function!")})

        window.contentArea.appendChild(this.container)
        
    }

    set onChange(value){
        this.element.removeEventListener('input', this._onClick)
        this._onClick = value
        this.element.addEventListener('input', this._onClick);
    }

    set value(value){
        this.element.value = value
    }

    get value(){
        return this.element.value
    }
}

export { OverlayWindow, Label, Button, Checkbox, Slider, Container, TextBox }