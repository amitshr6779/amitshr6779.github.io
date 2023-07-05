document.querySelector('button').addEventListener('click', tip_cal)


function tip_cal(){
    let bill_amount = document.querySelector('#bill').value
    let tip = document.querySelector('#tip').value
    let total_value = bill_amount*(1+tip/100)
    document.querySelector('#total').innerText = total_value.toFixed(2)

}
